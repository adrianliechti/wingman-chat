package store

import (
	"net/http"
	"sync"
	"time"

	"github.com/adrianliechti/wingman-chat/pkg/server/identity"
)

const (
	// Each upload can spool up to 257 MiB to disk, so the pod cap bounds
	// temporary storage. The account cap keeps one user from taking every slot.
	podUploads        = 4
	perAccountUploads = 2
	// Waiting longer than this returns 503 so clients retry instead of
	// piling up behind slow uploads.
	uploadQueueWait = 10 * time.Second
	// Matches the browser's transfer timeout and bounds how long a slow
	// client can hold a slot while sending its body.
	uploadBodyTimeout = 10 * time.Minute
)

// LimitUploads sets how many upload requests the pod handles at once. Values
// below one keep the default. Call it before Attach.
func (h *Handler) LimitUploads(pod int) *Handler {
	if pod > 0 {
		h.uploads = newUploadLimiter(pod, min(perAccountUploads, pod), uploadQueueWait, uploadBodyTimeout)
	}
	return h
}

type uploadLimiter struct {
	pod      chan struct{}
	perUser  int
	wait     time.Duration
	body     time.Duration
	mu       sync.Mutex
	accounts map[string]*accountSlots
}

type accountSlots struct {
	slots chan struct{}
	refs  int
}

func newUploadLimiter(pod, perUser int, wait, body time.Duration) *uploadLimiter {
	return &uploadLimiter{
		pod: make(chan struct{}, pod), perUser: perUser, wait: wait, body: body,
		accounts: map[string]*accountSlots{},
	}
}

func (l *uploadLimiter) account(id string) (chan struct{}, func()) {
	l.mu.Lock()
	defer l.mu.Unlock()
	a := l.accounts[id]
	if a == nil {
		a = &accountSlots{slots: make(chan struct{}, l.perUser)}
		l.accounts[id] = a
	}
	a.refs++
	return a.slots, func() {
		l.mu.Lock()
		defer l.mu.Unlock()
		if a.refs--; a.refs == 0 {
			delete(l.accounts, id)
		}
	}
}

// wrap waits before protection loads the index or the handler reads the body.
// One limiter serves all backup accounts in the pod.
func (l *uploadLimiter) wrap(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctx := r.Context()
		user, _ := identity.FromRequest(r)
		slots, release := l.account(user.ID)
		defer release()
		timeout := time.NewTimer(l.wait)
		defer timeout.Stop()
		// Take the account slot first so one account's queue never holds pod slots.
		for _, queue := range []chan struct{}{slots, l.pod} {
			select {
			case queue <- struct{}{}:
				defer func() { <-queue }()
			case <-timeout.C:
				w.Header().Set("Retry-After", "5")
				http.Error(w, "Backup uploads are busy. Retry shortly.", http.StatusServiceUnavailable)
				return
			case <-ctx.Done():
				return
			}
		}
		if ctx.Err() != nil {
			return
		}
		// Not every ResponseWriter supports deadlines; the server's other
		// timeouts still apply then.
		_ = http.NewResponseController(w).SetReadDeadline(time.Now().Add(l.body))
		next(w, r)
	}
}
