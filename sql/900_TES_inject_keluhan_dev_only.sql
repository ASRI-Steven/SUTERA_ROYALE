/* =====================================================================================
   TES DIGITAL TWIN (DEV SAJA). Satu keluhan "dari app" di Sutera Gardenia, belum dibuatkan tiket.
   Setelah dijalankan, dalam ±15 detik muncul di peta sebagai pin merah berdenyut + notifikasi
   "Keluhan baru: …". Penanda data uji: ComplaintTitle diawali 'TES DIGITAL TWIN', UCreate = 'DT-TES'.
   Hapus setelah demo pakai blok paling bawah (pin hilang saat BFF muat penuh, maksimal 10 menit).
   ===================================================================================== */
USE TownshipDB;
GO
DECLARE @Type BIGINT = COALESCE(
    (SELECT TOP 1 IDX_M_ComplaintType FROM M_ComplaintType WITH(NOLOCK)
      WHERE RecordStatus = 'A' AND (ComplaintTypeName LIKE '%lampu%' OR ComplaintTypeName LIKE '%PJU%')
      ORDER BY IDX_M_ComplaintType),
    (SELECT TOP 1 IDX_M_ComplaintType FROM M_ComplaintType WITH(NOLOCK) WHERE RecordStatus = 'A' ORDER BY IDX_M_ComplaintType));

INSERT INTO SL_T_ComplaintRequest
    (IDX_M_ComplaintType, IDX_M_Area, ComplaintTitle, ComplaintDescription, Longitude, Latitude, Address, ComplaintDate, ComplaintStatus, UCreate)
OUTPUT inserted.IDX_T_ComplaintRequest, inserted.IDX_M_ComplaintType
VALUES
    (@Type, 1, 'TES DIGITAL TWIN - lampu jalan mati', 'Data uji peta 3D, hapus setelah demo',
     106.65942, -6.25736, 'Sutera Gardenia (tes)', GETDATE(), 'RECEIVED', 'DT-TES');
GO

/* ---------- HAPUS SETELAH DEMO ----------
UPDATE SL_T_ComplaintRequest
   SET RecordStatus = 'D', DModified = GETDATE(), UModified = 'DT-TES'
 WHERE ComplaintTitle LIKE 'TES DIGITAL TWIN%' AND UCreate = 'DT-TES';
*/
