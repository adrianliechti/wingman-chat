import { useRef } from 'react';

/**
 * Hook to manage OpenAI Realtime voice streaming via WebRTC.
 * @param onUser called with user speech transcript
 * @param onAssistant called with assistant response transcript
 */
export function useVoiceWebRTC(
  onUser: (text: string) => void,
  onAssistant: (text: string) => void
) {
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const isActiveRef = useRef(false);

  const start = async (
    realtimeModel: string = "gpt-4o-realtime-preview",
    transcribeModel: string = "gpt-4o-transcribe", 
    instructions?: string
  ) => {
    if (isActiveRef.current) return;
    isActiveRef.current = true;

    try {
      // Create a peer connection
      const pc = new RTCPeerConnection();
      pcRef.current = pc;

      // Set up to play remote audio from the model
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;
      audioRef.current = audioEl;

      pc.ontrack = e => {
        if (audioEl) {
          audioEl.srcObject = e.streams[0];
        }
      };

      // Add local audio track for microphone input in the browser
      const ms = await navigator.mediaDevices.getUserMedia({
        audio: true
      });
      
      streamRef.current = ms;
      pc.addTrack(ms.getTracks()[0]);

      // Set up data channel for sending and receiving events
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;

      dc.addEventListener('open', () => {
        console.log('Data channel is open');
        // Set initial transcription model when data channel opens
        setTranscriptionModel(transcribeModel)
          .then(() => console.log('Default transcription model set'))
          .catch(error => console.warn('Failed to set default transcription model:', error));
        
        // Set initial instructions if provided
        if (instructions) {
          setInstructions(instructions)
            .then(() => console.log('Initial instructions set'))
            .catch(error => console.warn('Failed to set initial instructions:', error));
        }
      });

      dc.addEventListener("message", (e) => {
        try {
          const event = JSON.parse(e.data);
          console.log('Received event:', event);

          if (event.type === 'conversation.item.input_audio_transcription.completed') {
            onUser(event.transcript || '');
          }

          if (event.type === 'response.done') {
            if (event.response?.output?.[0]?.content?.[0]?.transcript) {
              onAssistant(event.response.output[0].content[0].transcript);
            }
          }
        } catch (error) {
          console.error('Error parsing event data:', error);
        }
      });

      // Start the session using the Session Description Protocol (SDP)
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Use relative path for WebSocket connection
      const baseUrl = `${window.location.protocol}//${window.location.host}/api/v1/realtime`;

      const sdpResponse = await fetch(`${baseUrl}?model=${realtimeModel}`, {
        method: "POST",
        body: offer.sdp,
        headers: {
          //Authorization: `Bearer ${OPENAI_API_KEY}`,
          "Content-Type": "application/sdp"
        },
      });

      if (!sdpResponse.ok) {
        const errorText = await sdpResponse.text();
        throw new Error(`SDP request failed with status ${sdpResponse.status}: ${errorText}`);
      }

      const answer = {
        type: "answer" as RTCSdpType,
        sdp: await sdpResponse.text(),
      };
      await pc.setRemoteDescription(answer);

      isActiveRef.current = true;
      console.log('Voice session started');
    } catch (error) {
      console.error('Error starting voice session:', error);
      // Clean up on error
      stop();
      throw error;
    }
  };

  const updateSession = async (session: Record<string, unknown>) => {
    try {
      if (!dcRef.current || dcRef.current.readyState !== 'open') {
        console.error('Cannot update session: Data channel not open');
        return false;
      }

      const event = {
        type: "session.update",
        session: session
      };

      dcRef.current.send(JSON.stringify(event));
      return true;
    } catch (error) {
      console.error('Error updating session:', error);
      return false;
    }
  };

  const setTranscriptionModel = async (model: string) => {
    return updateSession({
      input_audio_transcription: {
        model: model
      }
    });
  };

  const setInstructions = async (instructions: string) => {
    return updateSession({
      instructions: instructions
    });
  };

  const setVoice = async (voice: string) => {
    return updateSession({
      voice: voice
    });
  };

  const stop = () => {
    if (dcRef.current) {
      dcRef.current.close();
    }
    if (pcRef.current) {
      pcRef.current.close();
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
    }
    if (audioRef.current) {
      audioRef.current.remove();
    }

    // Reset refs
    pcRef.current = null;
    dcRef.current = null;
    audioRef.current = null;
    streamRef.current = null;
    isActiveRef.current = false;

    console.log('Voice session stopped');
  };

  return { start, stop, setInstructions, setVoice };
}