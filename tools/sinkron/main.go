// Sinkron: pantau cabang main di GitHub dan tarik update ke folder ini otomatis (tanpa perlu git pull manual).
//
// Dijalankan oleh anggota tim (mis. Jason) di laptopnya: dobel-klik Sinkron.command (macOS) / sinkron.bat (Windows),
// atau `cd tools/sinkron && go run .`. Biarkan jendelanya terbuka. Tiap ±30 dtk:
//   - ada commit baru di origin/main, cabang lokal = main, dan tidak ada perubahan lokal → fast-forward (git merge
//     --ff-only) + notifikasi desktop "N commit dari <nama>";
//   - ada perubahan lokal yang belum di-commit → tidak disentuh, hanya diberi tahu (sekali per update);
//   - cabang lokal punya commit sendiri (bercabang) atau sedang di cabang lain → hanya diberi tahu.
// Tidak pernah merge non-fast-forward, rebase, stash, atau push. Hanya pustaka standar Go.
//
//   go run .                  pantau terus (bawaan tiap 30 dtk)
//   go run . -once            cek & tarik sekali lalu keluar
//   go run . -every 1m -branch main -remote origin
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

var (
	branch = flag.String("branch", "main", "cabang yang diikuti")
	remote = flag.String("remote", "origin", "remote git")
	every  = flag.Duration("every", 30*time.Second, "jeda antar-cek")
	once   = flag.Bool("once", false, "cek & tarik sekali lalu keluar")
	quiet  = flag.Bool("no-notify", false, "tanpa notifikasi desktop (hanya log)")
)

var repo string // akar repo git

func git(timeout time.Duration, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = repo
	cmd.Env = append(os.Environ(), "GIT_TERMINAL_PROMPT=0", "LC_ALL=C") // jangan menunggu kata sandi di latar
	out, err := cmd.CombinedOutput()
	s := strings.TrimSpace(string(out))
	if ctx.Err() != nil {
		return s, errors.New("waktu habis: git " + strings.Join(args, " "))
	}
	if err != nil {
		return s, fmt.Errorf("git %s: %v: %s", strings.Join(args, " "), err, s)
	}
	return s, nil
}

func logf(format string, a ...any) { fmt.Printf("[%s] %s\n", time.Now().Format("15:04:05"), fmt.Sprintf(format, a...)) }

// notifikasi desktop: macOS (osascript), Windows (balon PowerShell), Linux (notify-send); gagal = diam saja
func notify(title, msg string) {
	logf("%s — %s", title, msg)
	if *quiet {
		return
	}
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "darwin":
		esc := func(s string) string { return strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(s) }
		cmd = exec.Command("osascript", "-e", fmt.Sprintf(`display notification "%s" with title "%s" sound name "Glass"`, esc(msg), esc(title)))
	case "windows":
		esc := func(s string) string { return strings.ReplaceAll(s, "'", "''") }
		ps := fmt.Sprintf(`Add-Type -AssemblyName System.Windows.Forms; Add-Type -AssemblyName System.Drawing; `+
			`$n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Information; $n.Visible = $true; `+
			`$n.ShowBalloonTip(10000, '%s', '%s', 'Info'); Start-Sleep -Seconds 11; $n.Dispose()`, esc(title), esc(msg))
		cmd = exec.Command("powershell", "-NoProfile", "-WindowStyle", "Hidden", "-Command", ps)
	default:
		cmd = exec.Command("notify-send", title, msg)
	}
	_ = cmd.Start() // tidak ditunggu (Windows menahan balon ±11 dtk)
}

var told = map[string]bool{} // pemberitahuan yang sudah dikirim (per isi) supaya tidak berulang tiap 30 dtk
func tellOnce(key, title, msg string) {
	if told[key] {
		return
	}
	told[key] = true
	notify(title, msg)
}

var failSince time.Time

func check() {
	if _, err := git(90*time.Second, "fetch", "--quiet", *remote, *branch); err != nil {
		if failSince.IsZero() {
			failSince = time.Now()
		}
		logf("gagal mengambil dari %s (dicoba lagi): %v", *remote, err)
		if time.Since(failSince) > 10*time.Minute {
			tellOnce("offline", "Sinkron Sutera Royale", "Tidak bisa menghubungi GitHub lebih dari 10 menit (jaringan diblokir?). Dicoba terus.")
		}
		return
	}
	failSince = time.Time{}
	delete(told, "offline")
	up := *remote + "/" + *branch
	head, err1 := git(10*time.Second, "rev-parse", "HEAD")
	tip, err2 := git(10*time.Second, "rev-parse", up)
	if err1 != nil || err2 != nil || head == tip {
		return
	}
	counts, err := git(10*time.Second, "rev-list", "--left-right", "--count", "HEAD..."+up)
	if err != nil {
		logf("%v", err)
		return
	}
	var ahead, behind int
	fmt.Sscan(counts, &ahead, &behind)
	if behind == 0 {
		return // hanya kita yang punya commit baru (belum di-push): urusan pemilik laptop
	}
	who, _ := git(10*time.Second, "log", "-1", "--format=%an", up)
	subj, _ := git(10*time.Second, "log", "-1", "--format=%s", up)
	what := fmt.Sprintf("%d commit baru dari %s: %s", behind, who, subj)
	cur, _ := git(10*time.Second, "rev-parse", "--abbrev-ref", "HEAD")
	if cur != *branch {
		tellOnce("branch:"+tip, "Ada update di "+*branch, what+fmt.Sprintf(" · kamu sedang di cabang %s (tidak ditarik)", cur))
		return
	}
	if ahead > 0 {
		tellOnce("diverged:"+tip, "Ada update, cabangmu bercabang", what+fmt.Sprintf(" · kamu punya %d commit lokal: jalankan git pull --rebase", ahead))
		return
	}
	if dirty, _ := git(20*time.Second, "status", "--porcelain", "--untracked-files=no"); dirty != "" {
		tellOnce("dirty:"+tip, "Ada update, belum ditarik", what+" · ada perubahan lokal yang belum di-commit: commit/stash dulu, nanti ditarik otomatis")
		return
	}
	if out, err := git(60*time.Second, "merge", "--ff-only", "--quiet", up); err != nil {
		tellOnce("fail:"+tip, "Update gagal ditarik", firstLine(out))
		return
	}
	// petunjuk sesuai yang berubah: web → muat ulang game, bff → build ulang server
	files, _ := git(20*time.Second, "diff", "--name-only", head, tip)
	hint := ""
	if strings.Contains("\n"+files, "\nbff/") {
		hint += " · server BFF berubah: cd bff && go build -o bin/alsut3d-bff ./cmd/server"
	}
	if strings.Contains("\n"+files, "\nweb/") {
		hint += " · muat ulang game (Cmd/Ctrl+Shift+R)"
	}
	notify("Sutera Royale diperbarui", what+hint)
}

func firstLine(s string) string {
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		return s[:i]
	}
	return s
}

func main() {
	flag.Parse()
	wd, _ := os.Getwd()
	repo = wd
	top, err := git(10*time.Second, "rev-parse", "--show-toplevel")
	if err != nil {
		fmt.Fprintln(os.Stderr, "Bukan folder repo git:", wd)
		os.Exit(1)
	}
	repo = filepath.Clean(top)
	logf("Sinkron %s → %s/%s tiap %s (Ctrl+C untuk berhenti)", repo, *remote, *branch, every.String())
	check()
	if *once {
		return
	}
	for range time.Tick(*every) {
		check()
	}
}
