# Sinkron — tarik update Sutera Royale otomatis

Untuk anggota tim yang ikut menguji/mengembangkan di laptopnya sendiri. Begitu ada push ke `main` di GitHub, folder
repo di laptopmu ikut diperbarui sendiri (±30 detik) dan muncul notifikasi desktop.

## Pakai
- **macOS:** dobel-klik `tools/sinkron/Sinkron.command` (pertama kali: klik kanan → Open kalau diblokir Gatekeeper).
- **Windows:** dobel-klik `tools/sinkron/sinkron.bat`.
- Atau dari terminal: `cd tools/sinkron && go run .` (butuh Go, sama seperti untuk build BFF).

Biarkan jendela Terminal/Command Prompt itu terbuka selama bekerja. Opsi: `-once` (cek & tarik sekali),
`-every 1m`, `-branch main`, `-no-notify`.

## Aman untuk pekerjaanmu
- Hanya **fast-forward** (`git merge --ff-only`): tidak pernah merge biasa, rebase, stash, atau push.
- Ada perubahan lokal yang belum di-commit → tidak ditarik, hanya diberi tahu; begitu bersih (commit/stash), ditarik otomatis.
- Kamu punya commit lokal yang belum di-push, atau sedang di cabang lain → hanya diberi tahu.
- Setelah ditarik: muat ulang game (Cmd/Ctrl+Shift+R); kalau `bff/` berubah, notifikasinya mengingatkan build ulang server.

## Email tiap push (diatur pemilik repo, sekali saja)
GitHub → repo `SUTERA_ROYALE` → **Settings** → bagian *Integrations* → **Email notifications** → isi alamat email
(maks. 2, pisahkan spasi) → **Setup notifications**. Tiap push mengirim email berisi daftar commit & tautan diff.
