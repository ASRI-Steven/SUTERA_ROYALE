// Command server: BFF peta Alam Sutera 3D (digital twin fase 1).
//
// Menyajikan folder web/ (peta) dan data keluhan dari TownshipDB lewat SP
// dbo.usp_DT_R_ComplaintMap_List (read-only). Perubahan dikirim ke browser lewat SSE (/api/stream).
// Konfigurasi dari .env (lihat .env.example). Tanpa DB_HOST, peta tetap jalan dan layer keluhan
// menampilkan "belum tersambung".
package main

import (
	"context"
	"database/sql"
	"errors"
	"log"
	"net/http"
	"net/url"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
	"github.com/joho/godotenv"
	_ "github.com/microsoft/go-mssqldb"

	"senara-digital-twin/bff/internal/complaints"
)

type config struct {
	listen       string
	webDir       string
	dsn          string
	areaID       *int64
	poll         time.Duration
	fullReload   time.Duration
	finishedDays int
}

func env(k, def string) string {
	if v := strings.TrimSpace(os.Getenv(k)); v != "" {
		return v
	}
	return def
}

func envInt(k string, def int) int {
	if v, err := strconv.Atoi(strings.TrimSpace(os.Getenv(k))); err == nil && v > 0 {
		return v
	}
	return def
}

func loadConfig() config {
	c := config{
		listen:       env("LISTEN_ADDR", "127.0.0.1:8765"),
		webDir:       env("WEB_DIR", "../web"),
		poll:         time.Duration(envInt("POLL_SECONDS", 15)) * time.Second,
		fullReload:   time.Duration(envInt("FULL_RELOAD_MINUTES", 10)) * time.Minute,
		finishedDays: envInt("FINISHED_DAYS", 7),
	}
	if host := env("DB_HOST", ""); host != "" {
		// Terima juga gaya Laravel "<ip>\SQLOPERATIONS": kalau port diisi, nama instance tidak perlu.
		instance := ""
		if i := strings.IndexByte(host, '\\'); i >= 0 {
			host, instance = host[:i], host[i+1:]
		}
		q := url.Values{}
		q.Set("database", env("DB_DATABASE", "TownshipDB"))
		q.Set("app name", "alsut-3d-bff")
		if v := env("DB_ENCRYPT", ""); v != "" {
			q.Set("encrypt", v)
		}
		if env("DB_TRUST_CERT", "") == "true" {
			q.Set("TrustServerCertificate", "true")
		}
		u := &url.URL{Scheme: "sqlserver", User: url.UserPassword(os.Getenv("DB_USERNAME"), os.Getenv("DB_PASSWORD")), RawQuery: q.Encode()}
		if port := env("DB_PORT", ""); port != "" {
			u.Host = host + ":" + port
		} else {
			u.Host = host
			if instance != "" {
				u.Path = "/" + instance
			}
		}
		c.dsn = u.String()
	}
	if v := env("AREA_ID", ""); v != "" {
		if n, err := strconv.ParseInt(v, 10, 64); err == nil {
			c.areaID = &n
		} else {
			log.Printf("AREA_ID %q bukan angka, diabaikan (semua area)", v)
		}
	}
	return c
}

func main() {
	if err := godotenv.Load(); err != nil && !errors.Is(err, os.ErrNotExist) {
		log.Printf("membaca .env: %v", err)
	}
	cfg := loadConfig()

	var repo *complaints.Repo
	if cfg.dsn != "" {
		db, err := sql.Open("sqlserver", cfg.dsn)
		if err != nil {
			log.Fatalf("konfigurasi DB tidak valid: %v", err)
		}
		db.SetMaxOpenConns(2)
		db.SetConnMaxIdleTime(5 * time.Minute)
		defer db.Close()
		repo = complaints.NewRepo(db, cfg.areaID, cfg.finishedDays)
		log.Printf("data keluhan: TownshipDB, poll tiap %s, muat penuh tiap %s", cfg.poll, cfg.fullReload)
	} else {
		log.Println("DB_HOST kosong: peta jalan tanpa data keluhan")
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	hub := complaints.NewHub(repo, cfg.poll, cfg.fullReload)
	go hub.Run(ctx)

	r := chi.NewRouter()
	r.Use(middleware.Recoverer)
	r.Get("/api/health", hub.HandleHealth)
	r.Get("/api/complaints", hub.HandleSnapshot)
	r.Get("/api/stream", hub.HandleStream)
	r.Handle("/*", noCache(http.FileServer(http.Dir(cfg.webDir))))

	srv := &http.Server{Addr: cfg.listen, Handler: r, ReadHeaderTimeout: 10 * time.Second}
	go func() {
		<-ctx.Done()
		sctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = srv.Shutdown(sctx)
	}()
	log.Printf("Alam Sutera 3D siap di http://%s", cfg.listen)
	if err := srv.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		log.Fatal(err)
	}
}

// noCache: file web (modul JS, GLB, data) selalu divalidasi ulang ke server (If-Modified-Since → 304 kalau tidak berubah).
// Tanpa ini browser memakai cache heuristik, sehingga setelah kode diperbarui modul lama & baru bisa tercampur dan game macet.
func noCache(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		h.ServeHTTP(w, r)
	})
}
