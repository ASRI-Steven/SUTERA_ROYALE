/* =====================================================================================
   SP       : dbo.usp_DT_R_ComplaintMap_List
   DB       : TownshipDB
   Fungsi   : Data peta Alam Sutera 3D (digital twin fase 1): keluhan, respond ticket, dan WO
              per detail keluhan, lengkap dengan tahap dan koordinat. READ-ONLY.
   Dipakai  : SENARA_DIGITAL_TWIN/bff (poll tiap 15 detik, @SinceModified = perubahan terakhir).

   Tahap (kolom Stage), dihitung dari tanggal supaya tidak bergantung kode status:
     DITOLAK  RejectDate terisi
     SELESAI  FinishDate terisi, atau ComplaintDetailStatus = 'FINISH', atau header CLOSED
     WO       WorkOrderDate / WorkOrderNo terisi
     RESPON   RespondDate terisi
     BARU     belum direspon, termasuk keluhan dari app (SL_T_ComplaintRequest) yang belum dibuatkan tiket

   Koordinat: GPS dari app (SL_T_ComplaintRequest.Latitude/Longitude); kalau tidak ada, lokasi unit
   (DM_M_UnitLocation lewat M_Product.ProductCode). Baris tanpa koordinat tetap dikirim (Latitude NULL).
   Data pribadi pelapor (nama, kontak, email, foto) TIDAK dikirim.

   Yang perlu dicek Steven sebelum dipakai (lihat juga HANDOFF.md §15):
     1. Kode SL_T_ComplaintRequest.ComplaintStatus untuk keluhan app yang ditolak/batal
        (sementara dianggap: CLOSED, REJECT, REJECTED, CANCEL).
     2. IDX_M_Area untuk Alam Sutera (parameter @IDX_M_Area; NULL = semua area).
     3. Apakah T_ComplaintDetail punya kolom DModified (kalau ada, tambahkan ke LastChange).

   History  :
   1. 09 November 2026  Claude (draft untuk Steven)  1.0  Buat baru
   ===================================================================================== */
USE TownshipDB;
GO
CREATE OR ALTER PROCEDURE [dbo].[usp_DT_R_ComplaintMap_List] -- SP baru milik digital twin; aman dijalankan ulang
    @IDX_M_Area     BIGINT   = NULL,  -- NULL = semua area
    @SinceModified  DATETIME = NULL,  -- NULL = muat penuh; terisi = hanya yang berubah setelah waktu ini
    @FinishedDays   INT      = 7      -- keluhan SELESAI/DITOLAK yang masih ditampilkan (hari ke belakang)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @FinishedFrom DATETIME = DATEADD(DAY, -ISNULL(@FinishedDays, 7), CAST(GETDATE() AS DATE));

    ;WITH Dtl AS (
        SELECT
            'DTL'                                   AS SourceType,
            CD.IDX_T_ComplaintRequest,
            CH.IDX_T_ComplaintHeader,
            CD.IDX_T_ComplaintDetail,
            CH.ComplaintNo,
            CT.ComplaintTypeName,
            CT.StandardHour,
            CASE
                WHEN CD.RejectDate IS NOT NULL THEN 'DITOLAK'
                WHEN CD.FinishDate IS NOT NULL OR CD.ComplaintDetailStatus = 'FINISH' OR CH.ComplaintStatus = 'CLOSED' THEN 'SELESAI'
                WHEN CD.WorkOrderDate IS NOT NULL OR CD.WorkOrderNo IS NOT NULL THEN 'WO'
                WHEN CD.RespondDate IS NOT NULL THEN 'RESPON'
                ELSE 'BARU'
            END                                     AS Stage,
            CH.ComplaintStatus,
            CD.ComplaintDetailStatus,
            CD.WorkOrderStatus,
            CD.WorkOrderNo,
            CH.ComplaintDate,
            CD.RespondDate,
            CD.WorkOrderDate,
            CD.WorkOrderStartDate,
            CD.FinishDate,
            CD.RejectDate,
            TRY_CAST(COALESCE(SR.Latitude,  UL.Latitude)  AS DECIMAL(12, 9)) AS Latitude,
            TRY_CAST(COALESCE(SR.Longitude, UL.Longitude) AS DECIMAL(12, 9)) AS Longitude,
            CASE WHEN SR.Latitude IS NOT NULL THEN 'APP' WHEN UL.Latitude IS NOT NULL THEN 'UNIT' END AS LocationSource,
            P.ProductCode,
            UL.ClusterID,
            LEFT(CD.ComplaintDescription, 200)      AS Summary,
            (SELECT MAX(v) FROM (VALUES (CH.DCreate), (CH.DModified), (CD.RespondDate), (CD.WorkOrderDate),
                                        (CD.WorkOrderStartDate), (CD.FinishDate), (CD.RejectDate), (SR.DModified)) AS x(v)) AS LastChange
        FROM T_ComplaintHeader CH WITH(NOLOCK)
        JOIN T_ComplaintDetail CD WITH(NOLOCK) ON CD.IDX_T_ComplaintHeader = CH.IDX_T_ComplaintHeader
        LEFT JOIN M_ComplaintType CT WITH(NOLOCK) ON CT.IDX_M_ComplaintType = CD.IDX_M_ComplaintType
        LEFT JOIN SL_T_ComplaintRequest SR WITH(NOLOCK) ON SR.IDX_T_ComplaintRequest = CD.IDX_T_ComplaintRequest
        LEFT JOIN M_Product P WITH(NOLOCK) ON P.IDX_M_Product = CH.IDX_M_Product
        LEFT JOIN DM_M_UnitLocation UL WITH(NOLOCK) ON UL.ProductCode = P.ProductCode AND UL.RecordStatus = 'A'
        WHERE CH.RecordStatus = 'A'
          AND CH.ComplaintStatus <> 'DRAFT'
          AND (@IDX_M_Area IS NULL OR CH.IDX_M_Area = @IDX_M_Area)
    ),
    Req (SourceType, IDX_T_ComplaintRequest, IDX_T_ComplaintHeader, IDX_T_ComplaintDetail, ComplaintNo,
         ComplaintTypeName, StandardHour, Stage, ComplaintStatus, ComplaintDetailStatus, WorkOrderStatus, WorkOrderNo,
         ComplaintDate, RespondDate, WorkOrderDate, WorkOrderStartDate, FinishDate, RejectDate,
         Latitude, Longitude, LocationSource, ProductCode, ClusterID, Summary, LastChange) AS ( -- keluhan dari app yang belum dibuatkan tiket di BO
        SELECT
            'REQ', SR.IDX_T_ComplaintRequest, NULL, NULL, NULL,
            CT.ComplaintTypeName, CT.StandardHour, 'BARU',
            SR.ComplaintStatus, NULL, NULL, NULL,
            SR.ComplaintDate, NULL, NULL, NULL, NULL, NULL,
            TRY_CAST(SR.Latitude AS DECIMAL(12, 9)), TRY_CAST(SR.Longitude AS DECIMAL(12, 9)), 'APP',
            NULL, NULL,
            LEFT(SR.ComplaintTitle, 200),
            COALESCE(SR.DModified, SR.DCreate)
        FROM SL_T_ComplaintRequest SR WITH(NOLOCK)
        LEFT JOIN M_ComplaintType CT WITH(NOLOCK) ON CT.IDX_M_ComplaintType = SR.IDX_M_ComplaintType
        WHERE SR.RecordStatus = 'A'
          AND (@IDX_M_Area IS NULL OR SR.IDX_M_Area = @IDX_M_Area)
          AND ISNULL(SR.ComplaintStatus, '') NOT IN ('CLOSED', 'REJECT', 'REJECTED', 'CANCEL')
          AND NOT EXISTS (SELECT 1 FROM T_ComplaintDetail CD WITH(NOLOCK) WHERE CD.IDX_T_ComplaintRequest = SR.IDX_T_ComplaintRequest)
    )
    SELECT A.*
    FROM (SELECT * FROM Dtl UNION ALL SELECT * FROM Req) A
    WHERE (A.Stage IN ('BARU', 'RESPON', 'WO') OR A.LastChange >= @FinishedFrom)
      AND (@SinceModified IS NULL OR A.LastChange > @SinceModified)
    ORDER BY A.LastChange DESC;
END
GO

/* Uji cepat (Steven, di DEV):
   EXEC dbo.usp_DT_R_ComplaintMap_List;                                  -- muat penuh
   EXEC dbo.usp_DT_R_ComplaintMap_List @SinceModified = '2026-11-09 08:00'; -- hanya perubahan
   Hak akses user BFF (read-only):  GRANT EXECUTE ON dbo.usp_DT_R_ComplaintMap_List TO <user_bff>;
*/
