package flash

import (
	"slices"
	"strings"
	"testing"
)

func TestArgsUploadOnlyToTheNamedBoard(t *testing.T) {
	job := Job{RepoRoot: "/repo", Env: "final_app", Serial: "FBC116E9"}
	want := []string{"run", "--project-dir", "/repo", "-e", "final_app", "-t", "upload", "--upload-port", "FBC116E9"}
	if got := job.Args(); !slices.Equal(got, want) {
		t.Fatalf("got %v, want %v", got, want)
	}
}

func TestArgsWithNoBoardOnlyBuild(t *testing.T) {
	got := Job{RepoRoot: "/repo", Env: "bench"}.Args()
	if slices.Contains(got, "upload") || slices.Contains(got, "--upload-port") {
		t.Fatalf("a job with no board must not upload: %v", got)
	}
}

func TestEnvironPassesBenchFlagsOnlyWhenThereAreSome(t *testing.T) {
	base := []string{"PATH=/bin"}
	flagged := Job{SrcFlags: []string{"-DBENCH_TEST=0", "-DBENCH_MOTION=1"}}.Environ(base)
	if !slices.Contains(flagged, "PLATFORMIO_BUILD_SRC_FLAGS=-DBENCH_TEST=0 -DBENCH_MOTION=1") {
		t.Fatalf("got %v", flagged)
	}
	// A stale value left in the shell must not leak into a whole-firmware build.
	plain := Job{}.Environ([]string{"PATH=/bin", "PLATFORMIO_BUILD_SRC_FLAGS=-DBENCH_TEST=2"})
	for _, entry := range plain {
		if strings.HasPrefix(entry, "PLATFORMIO_BUILD_SRC_FLAGS=") {
			t.Fatalf("got %v", plain)
		}
	}
}

func TestStageFollowsPlatformIOOutput(t *testing.T) {
	tests := []struct {
		line string
		want Stage
		ok   bool
	}{
		{"Processing final_app (board: seeed-xiao-mg24; platform: ...)", StageBuilding, true},
		{"Compiling .pio/build/final_app/src/main.cpp.o", StageBuilding, true},
		{"Configuring upload protocol...", StageUploading, true},
		{"mg24 upload: targeting probe FBC116E9", StageUploading, true},
		{"** Programming Started **", StageUploading, true},
		{"RAM:   [==        ]  21.3% (used 55800 bytes)", 0, false},
	}
	for _, test := range tests {
		got, ok := StageFromOutput(test.line)
		if ok != test.ok || (ok && got != test.want) {
			t.Errorf("StageFromOutput(%q) = %v, %t; want %v, %t", test.line, got, ok, test.want, test.ok)
		}
	}
}

func TestErrorLinesAreWhatToPinOnAFailedFlash(t *testing.T) {
	for _, line := range []string{
		"mg24 upload: no MG24 matches 'NOPE'. Connected: none",
		"src/main.cpp:3:10: fatal error: nope.h: No such file or directory",
		"Error: unable to find a matching CMSIS-DAP device",
		"*** [upload] Error 1",
	} {
		if !IsErrorLine(line) {
			t.Errorf("IsErrorLine(%q) = false", line)
		}
	}
	// A file whose name happens to say "error" compiling fine is not a failure.
	for _, line := range []string{
		"Compiling .pio/build/final_app/FrameworkArduino/sl_error_handler.c.o",
		"Archiving .pio/build/final_app/liberrors.a",
		"mg24 upload: targeting probe FBC116E9",
		"Building in release mode",
	} {
		if IsErrorLine(line) {
			t.Errorf("IsErrorLine(%q) = true", line)
		}
	}
}

func TestBuildsCoverWholeFirmwareFlashes(t *testing.T) {
	var envs []string
	for _, build := range Builds {
		envs = append(envs, build.Env)
	}
	if want := []string{"final_app", "imu_debug", "strip_test", "strip_off"}; !slices.Equal(envs, want) {
		t.Fatalf("got %v, want %v", envs, want)
	}
}
