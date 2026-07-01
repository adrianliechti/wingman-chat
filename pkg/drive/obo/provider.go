package obo

import (
	"context"
	"io"

	"github.com/adrianliechti/wingman-chat/pkg/drive"
)

var _ drive.Provider = (*Provider)(nil)

// Provider wraps a drive.Provider and replaces the incoming user token in the
// context with an On-Behalf-Of exchanged token before delegating.
type Provider struct {
	provider  drive.Provider
	exchanger *Exchanger
}

func Wrap(p drive.Provider, e *Exchanger) *Provider {
	return &Provider{
		provider:  p,
		exchanger: e,
	}
}

func (p *Provider) List(ctx context.Context, id string) ([]drive.Entry, error) {
	ctx, err := p.exchange(ctx)

	if err != nil {
		return nil, err
	}

	return p.provider.List(ctx, id)
}

func (p *Provider) Open(ctx context.Context, id string) (io.ReadCloser, string, int64, error) {
	ctx, err := p.exchange(ctx)

	if err != nil {
		return nil, "", 0, err
	}

	return p.provider.Open(ctx, id)
}

func (p *Provider) exchange(ctx context.Context) (context.Context, error) {
	assertion := drive.TokenFromContext(ctx)

	if assertion == "" {
		return ctx, nil
	}

	token, err := p.exchanger.Token(ctx, assertion)

	if err != nil {
		return nil, err
	}

	return drive.WithToken(ctx, token), nil
}
