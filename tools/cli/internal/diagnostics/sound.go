package diagnostics

import (
	"bytes"
	"context"
	"encoding/binary"
	"fmt"
	"math"
	"os"
	"os/exec"
	"runtime"
	"strings"
	"time"

	"firewalker/cli/internal/proc"
)

// TonePlayer is the host audio output. Play returns only after playback finishes;
// capture runs alongside it. Cancellation must stop sound before returning.
type TonePlayer interface {
	Name() string
	Play(context.Context, int, time.Duration, float64) error
}

type nativePlayer struct {
	executable string
	kind       string
}

// SystemPlayer chooses an installed native player without changing output devices
// or system volume. WAV generation is shared across macOS, Linux, and Windows;
// only the final playback command differs. Missing playback is an error, never a
// silent tone that makes every connected microphone fail.
func SystemPlayer() (TonePlayer, error) {
	var candidates []string
	switch runtime.GOOS {
	case "darwin":
		candidates = []string{"afplay", "ffplay"}
	case "windows":
		candidates = []string{"powershell", "pwsh", "ffplay"}
	default:
		candidates = []string{"paplay", "aplay", "ffplay"}
	}
	for _, name := range candidates {
		if path, err := exec.LookPath(name); err == nil {
			return nativePlayer{path, name}, nil
		}
	}
	return nil, fmt.Errorf("no audio player found; install one of %s, then retry", strings.Join(candidates, ", "))
}

func (p nativePlayer) Name() string { return p.kind + " (system audio output)" }

func (p nativePlayer) Play(ctx context.Context, hz int, duration time.Duration, volume float64) error {
	file, err := os.CreateTemp("", "firewalker-tone-*.wav")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	data := toneWAV(hz, duration, volume)
	_, writeErr := file.Write(data)
	closeErr := file.Close()
	if writeErr != nil {
		return writeErr
	}
	if closeErr != nil {
		return closeErr
	}
	var args []string
	switch p.kind {
	case "aplay":
		args = []string{"-q", file.Name()}
	case "ffplay":
		args = []string{"-nodisp", "-autoexit", "-loglevel", "error", file.Name()}
	case "powershell", "pwsh":
		// Pass the path in an environment variable instead of interpolating it
		// into PowerShell code; user profile paths can contain spaces or quotes.
		args = []string{"-NoProfile", "-NonInteractive", "-Command", "$p = New-Object System.Media.SoundPlayer; $p.SoundLocation = $env:FIREWALKER_DIAGNOSTIC_WAV; $p.PlaySync()"}
	default:
		args = []string{file.Name()}
	}
	command := exec.CommandContext(ctx, p.executable, args...)
	command.Env = append(os.Environ(), "FIREWALKER_DIAGNOSTIC_WAV="+file.Name())
	command.WaitDelay = time.Second
	proc.StopGroupOnCancel(command)
	var output bytes.Buffer
	command.Stdout, command.Stderr = &output, &output
	if err := command.Run(); err != nil {
		if ctx.Err() != nil {
			return ctx.Err()
		}
		return fmt.Errorf("%s playback failed: %w %s", p.kind, err, strings.TrimSpace(output.String()))
	}
	return nil
}

// toneWAV writes mono 16-bit PCM with short fades so starting and stopping a
// known tone does not add a click to the sound being measured.
func toneWAV(hz int, duration time.Duration, volume float64) []byte {
	const rate = 22050
	count := int(duration.Seconds() * rate)
	data := make([]byte, 44+count*2)
	copy(data[0:4], "RIFF")
	binary.LittleEndian.PutUint32(data[4:8], uint32(len(data)-8))
	copy(data[8:16], "WAVEfmt ")
	binary.LittleEndian.PutUint32(data[16:20], 16)
	binary.LittleEndian.PutUint16(data[20:22], 1)
	binary.LittleEndian.PutUint16(data[22:24], 1)
	binary.LittleEndian.PutUint32(data[24:28], rate)
	binary.LittleEndian.PutUint32(data[28:32], rate*2)
	binary.LittleEndian.PutUint16(data[32:34], 2)
	binary.LittleEndian.PutUint16(data[34:36], 16)
	copy(data[36:40], "data")
	binary.LittleEndian.PutUint32(data[40:44], uint32(count*2))
	for n := range count {
		fade := math.Min(1, math.Min(float64(n)/(rate*.02), float64(count-1-n)/(rate*.02)))
		value := int16(32767 * volume * fade * math.Sin(2*math.Pi*float64(hz*n)/rate))
		binary.LittleEndian.PutUint16(data[44+n*2:], uint16(value))
	}
	return data
}
