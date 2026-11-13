// Package complaints mengambil data keluhan untuk peta dari TownshipDB dan menyiarkannya ke browser.
package complaints

import (
	"context"
	"database/sql"
	"fmt"
	"log"
	"strings"
	"time"
)

// wib: kolom DATETIME di TownshipDB berisi jam WIB tanpa zona. Driver membacanya sebagai UTC,
// jadi untuk JSON jam dinding yang sama dilabeli ulang sebagai WIB.
var wib = time.FixedZone("WIB", 7*3600)

// Item satu baris peta: satu detail keluhan (DTL) atau keluhan app yang belum jadi tiket (REQ).
// Tidak ada data pribadi pelapor (nama, kontak, email, foto).
type Item struct {
	Key          string     `json:"key"`
	Src          string     `json:"src"`
	ReqID        *int64     `json:"reqId,omitempty"`
	HeaderID     *int64     `json:"headerId,omitempty"`
	DetailID     *int64     `json:"detailId,omitempty"`
	No           *string    `json:"no,omitempty"`
	Type         *string    `json:"type,omitempty"`
	SLAHours     *int64     `json:"slaHours,omitempty"`
	Stage        string     `json:"stage"`
	StatusHeader *string    `json:"statusHeader,omitempty"`
	StatusDetail *string    `json:"statusDetail,omitempty"`
	WOStatus     *string    `json:"woStatus,omitempty"`
	WONo         *string    `json:"woNo,omitempty"`
	Created      *time.Time `json:"created,omitempty"`
	Responded    *time.Time `json:"responded,omitempty"`
	WODate       *time.Time `json:"woDate,omitempty"`
	WOStart      *time.Time `json:"woStart,omitempty"`
	Finished     *time.Time `json:"finished,omitempty"`
	Rejected     *time.Time `json:"rejected,omitempty"`
	Lat          *float64   `json:"lat,omitempty"`
	Lng          *float64   `json:"lng,omitempty"`
	LocSrc       *string    `json:"locSrc,omitempty"`
	Unit         *string    `json:"unit,omitempty"`
	Cluster      *string    `json:"cluster,omitempty"`
	Summary      *string    `json:"summary,omitempty"`
	LastChange   *time.Time `json:"lastChange,omitempty"`
	// Detail respond ticket & WO (hanya dari SP v2)
	AssignGroup       *string    `json:"assignGroup,omitempty"`
	RespondNote       *string    `json:"respondNote,omitempty"`
	HandlingEstStart  *time.Time `json:"handlingEstStart,omitempty"`
	HandlingEstFinish *time.Time `json:"handlingEstFinish,omitempty"`
	WOEstStart        *time.Time `json:"woEstStart,omitempty"`
	WOEstFinish       *time.Time `json:"woEstFinish,omitempty"`
	WOEnd             *time.Time `json:"woEnd,omitempty"`
	WONote            *string    `json:"woNote,omitempty"`
	WOAssignCount     *int64     `json:"woAssignCount,omitempty"`
}

// Repo memanggil SP peta keluhan: v2 (dengan detail respond & WO) bila sudah ada, kalau belum v1.
type Repo struct {
	db           *sql.DB
	area         *int64
	finishedDays int
	procs        []string
	cur          int
}

func NewRepo(db *sql.DB, area *int64, finishedDays int) *Repo {
	return &Repo{db: db, area: area, finishedDays: finishedDays,
		procs: []string{"dbo.usp_DT_R_ComplaintMap_List_v2", "dbo.usp_DT_R_ComplaintMap_List"}}
}

// List mengembalikan baris yang berubah setelah since (nil = muat penuh) dan nilai LastChange
// terbesar apa adanya dari DB (dipakai lagi sebagai @SinceModified berikutnya).
func (r *Repo) List(ctx context.Context, since *time.Time) ([]Item, *time.Time, error) {
	if since == nil {
		r.cur = 0 // muat penuh: coba lagi versi SP terbaru
	}
	for {
		items, maxRaw, err := r.list(ctx, r.procs[r.cur], since)
		if err != nil && strings.Contains(err.Error(), "Could not find stored procedure") && r.cur < len(r.procs)-1 {
			log.Printf("%s belum ada di DB, pakai %s", r.procs[r.cur], r.procs[r.cur+1])
			r.cur++
			continue
		}
		return items, maxRaw, err
	}
}

func (r *Repo) list(ctx context.Context, proc string, since *time.Time) ([]Item, *time.Time, error) {
	var area, sinceArg any
	if r.area != nil {
		area = *r.area
	}
	if since != nil {
		sinceArg = *since
	}
	// Teks tanpa spasi = dipanggil sebagai stored procedure (RPC) oleh go-mssqldb.
	rows, err := r.db.QueryContext(ctx, proc,
		sql.Named("IDX_M_Area", area), sql.Named("SinceModified", sinceArg), sql.Named("FinishedDays", r.finishedDays))
	if err != nil {
		return nil, nil, fmt.Errorf("exec %s: %w", proc, err)
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return nil, nil, err
	}
	ext := len(cols) >= 34 // SP v2

	var out []Item
	var maxRaw *time.Time
	for rows.Next() {
		var (
			src, stage                                             string
			req, hdr, dtl, sla                                     sql.NullInt64
			no, typ, sh, sd, wos, won, locSrc, unit, clus, summary sql.NullString
			created, responded, woDate, woStart, fin, rej, last    sql.NullTime
			lat, lng                                               sql.NullFloat64
			grp, rnote, wnote                                      sql.NullString
			hs, hf, wes, wef, wend                                 sql.NullTime
			wac                                                    sql.NullInt64
		)
		dest := []any{&src, &req, &hdr, &dtl, &no, &typ, &sla, &stage, &sh, &sd, &wos, &won,
			&created, &responded, &woDate, &woStart, &fin, &rej, &lat, &lng, &locSrc, &unit, &clus, &summary, &last}
		if ext {
			dest = append(dest, &grp, &rnote, &hs, &hf, &wes, &wef, &wend, &wnote, &wac)
		}
		if err := rows.Scan(dest...); err != nil {
			return nil, nil, fmt.Errorf("scan baris keluhan: %w", err)
		}
		it := Item{
			Src: src, Stage: stage, ReqID: i64(req), HeaderID: i64(hdr), DetailID: i64(dtl), No: str(no), Type: str(typ),
			SLAHours: i64(sla), StatusHeader: str(sh), StatusDetail: str(sd), WOStatus: str(wos), WONo: str(won),
			Created: ts(created), Responded: ts(responded), WODate: ts(woDate), WOStart: ts(woStart), Finished: ts(fin),
			Rejected: ts(rej), Lat: f64(lat), Lng: f64(lng), LocSrc: str(locSrc), Unit: str(unit), Cluster: str(clus),
			Summary: str(summary), LastChange: ts(last),
		}
		if ext {
			it.AssignGroup, it.RespondNote, it.WONote = str(grp), str(rnote), str(wnote)
			it.HandlingEstStart, it.HandlingEstFinish = ts(hs), ts(hf)
			it.WOEstStart, it.WOEstFinish, it.WOEnd = ts(wes), ts(wef), ts(wend)
			it.WOAssignCount = i64(wac)
		}
		if src == "REQ" {
			it.Key = fmt.Sprintf("REQ-%d", req.Int64)
		} else {
			it.Key = fmt.Sprintf("DTL-%d", dtl.Int64)
		}
		out = append(out, it)
		if last.Valid && (maxRaw == nil || last.Time.After(*maxRaw)) {
			t := last.Time
			maxRaw = &t
		}
	}
	return out, maxRaw, rows.Err()
}

func i64(v sql.NullInt64) *int64 {
	if !v.Valid {
		return nil
	}
	return &v.Int64
}

func str(v sql.NullString) *string {
	if !v.Valid {
		return nil
	}
	return &v.String
}

func f64(v sql.NullFloat64) *float64 {
	if !v.Valid {
		return nil
	}
	return &v.Float64
}

func ts(v sql.NullTime) *time.Time {
	if !v.Valid {
		return nil
	}
	t := v.Time
	w := time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), wib)
	return &w
}
