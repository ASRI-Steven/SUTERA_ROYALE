/* =====================================================================================
   READ-ONLY. Ekspor koordinat unit per cluster dari data internal, untuk membentuk batas cluster
   di peta 3D (menggantikan batas versi OpenStreetMap).
   Jalankan di TownshipDB dev, lalu simpan hasil grid sebagai JSON atau CSV ke:
     ~/Documents/web/SENARA_DIGITAL_TWIN/data/unit_cluster.json  (atau .csv)
   Catatan: kolom kunci ClusterID di DM_M_UnitLocation belum pasti cocok ke DefaultCode atau
   SubClusterCode di M_ProductCluster, jadi dua-duanya dicoba. Cek beberapa baris hasilnya.
   ===================================================================================== */
USE TownshipDB;
GO
SELECT
    UL.ClusterID,
    PC.Name            AS ClusterName,
    PC.SubClusterName,
    UL.ProductCode,
    UL.Latitude,
    UL.Longitude,
    UL.Source
FROM DM_M_UnitLocation UL WITH(NOLOCK)
LEFT JOIN M_ProductCluster PC WITH(NOLOCK)
       ON (PC.DefaultCode = UL.ClusterID OR PC.SubClusterCode = UL.ClusterID) AND PC.RecordStatus = 'A'
WHERE UL.RecordStatus = 'A'
ORDER BY UL.ClusterID, UL.ProductCode;
