package complaints

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"
)

// Hub menyimpan data keluhan terakhir di memori, poll DB berkala, dan menyiarkan perubahan ke
// semua browser lewat SSE. DB hanya di-query sekali per interval, berapa pun jumlah layar.
type Hub struct {
	repo       *Repo
	poll, full time.Duration

	mu        sync.Mutex
	items     map[string]Item
	since     *time.Time // LastChange terbesar apa adanya dari DB
	lastPoll  time.Time
	lastErr   string
	connected bool
	subs      map[chan []byte]struct{}
	done      chan struct{}
}

func NewHub(repo *Repo, poll, full time.Duration) *Hub {
	return &Hub{repo: repo, poll: poll, full: full, items: map[string]Item{}, subs: map[chan []byte]struct{}{}, done: make(chan struct{})}
}

// Run berjalan sampai ctx selesai: muat penuh di awal, lalu ambil perubahan tiap poll dan muat penuh tiap full.
func (h *Hub) Run(ctx context.Context) {
	defer close(h.done)
	if h.repo == nil {
		<-ctx.Done()
		return
	}
	h.refresh(ctx, true)
	tick := time.NewTicker(h.poll)
	defer tick.Stop()
	lastFull := time.Now()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			full := time.Since(lastFull) >= h.full
			if full {
				lastFull = time.Now()
			}
			h.refresh(ctx, full)
		}
	}
}

func (h *Hub) refresh(ctx context.Context, full bool) {
	h.mu.Lock()
	var since *time.Time
	if !full && h.since != nil {
		s := h.since.Add(-2 * time.Second) // tumpang tindih sedikit: aman dari baris yang tercatat di detik yang sama
		since = &s
	}
	h.mu.Unlock()

	cctx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	items, maxRaw, err := h.repo.List(cctx, since)

	h.mu.Lock()
	h.lastPoll = time.Now()
	if err != nil {
		h.connected = false
		h.lastErr = err.Error()
		msg := h.statusLocked()
		h.mu.Unlock()
		log.Printf("ambil data keluhan gagal: %v", err)
		h.publish(msg)
		return
	}
	h.connected, h.lastErr = true, ""
	if maxRaw != nil && (h.since == nil || maxRaw.After(*h.since)) {
		h.since = maxRaw
	}
	var msg []byte
	if full {
		h.items = make(map[string]Item, len(items))
		for _, it := range items {
			h.items[it.Key] = it
		}
		msg = h.snapshotLocked()
	} else {
		changed := make([]Item, 0, len(items))
		for _, it := range items {
			if old, ok := h.items[it.Key]; !ok || !same(old, it) {
				h.items[it.Key] = it
				changed = append(changed, it)
			}
		}
		if len(changed) > 0 {
			msg = event("delta", map[string]any{"items": changed, "lastPoll": h.lastPoll})
		} else {
			msg = h.statusLocked()
		}
	}
	h.mu.Unlock()
	h.publish(msg)
}

func same(a, b Item) bool {
	ja, _ := json.Marshal(a)
	jb, _ := json.Marshal(b)
	return string(ja) == string(jb)
}

func (h *Hub) payloadLocked(withItems bool) map[string]any {
	p := map[string]any{"configured": h.repo != nil, "connected": h.connected, "error": h.lastErr}
	if !h.lastPoll.IsZero() {
		p["lastPoll"] = h.lastPoll
	}
	if withItems {
		list := make([]Item, 0, len(h.items))
		for _, it := range h.items {
			list = append(list, it)
		}
		p["items"] = list
	}
	return p
}

func (h *Hub) snapshotLocked() []byte { return event("snapshot", h.payloadLocked(true)) }
func (h *Hub) statusLocked() []byte   { return event("status", h.payloadLocked(false)) }

func event(name string, v any) []byte {
	b, err := json.Marshal(v)
	if err != nil {
		b = []byte(`{}`)
	}
	return []byte(fmt.Sprintf("event: %s\ndata: %s\n\n", name, b))
}

func (h *Hub) publish(msg []byte) {
	h.mu.Lock()
	defer h.mu.Unlock()
	for ch := range h.subs {
		select {
		case ch <- msg:
		default: // browser lambat: lewati, nanti dapat snapshot berikutnya
		}
	}
}

// HandleStream: SSE. Kirim snapshot saat tersambung, lalu delta/status setiap poll.
func (h *Hub) HandleStream(w http.ResponseWriter, r *http.Request) {
	fl, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming tidak didukung", http.StatusInternalServerError)
		return
	}
	w.Header().Set("Content-Type", "text/event-stream")
	w.Header().Set("Cache-Control", "no-cache")
	w.Header().Set("Connection", "keep-alive")
	ch := make(chan []byte, 16)
	h.mu.Lock()
	h.subs[ch] = struct{}{}
	first := h.snapshotLocked()
	h.mu.Unlock()
	defer func() {
		h.mu.Lock()
		delete(h.subs, ch)
		h.mu.Unlock()
	}()
	_, _ = w.Write([]byte("retry: 10000\n\n"))
	_, _ = w.Write(first)
	fl.Flush()
	ping := time.NewTicker(25 * time.Second)
	defer ping.Stop()
	for {
		select {
		case <-r.Context().Done():
			return
		case <-h.done:
			return
		case msg := <-ch:
			_, _ = w.Write(msg)
			fl.Flush()
		case <-ping.C:
			_, _ = w.Write([]byte(": ping\n\n"))
			fl.Flush()
		}
	}
}

// HandleSnapshot: data keluhan lengkap sekali ambil (JSON biasa).
func (h *Hub) HandleSnapshot(w http.ResponseWriter, _ *http.Request) {
	h.mu.Lock()
	p := h.payloadLocked(true)
	h.mu.Unlock()
	writeJSON(w, p)
}

// HandleHealth: status koneksi tanpa data.
func (h *Hub) HandleHealth(w http.ResponseWriter, _ *http.Request) {
	h.mu.Lock()
	p := h.payloadLocked(false)
	p["items"] = len(h.items)
	h.mu.Unlock()
	writeJSON(w, p)
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	_ = json.NewEncoder(w).Encode(v)
}
