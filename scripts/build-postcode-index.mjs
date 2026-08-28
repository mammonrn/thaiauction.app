/**
 * Regenerate lib/data/thai-postcodes.json from the upstream dataset.
 *
 * Source : kongvut/thai-province-data (MIT), api/latest
 *          https://github.com/kongvut/thai-province-data
 * Run    : node scripts/build-postcode-index.mjs
 *
 * The upstream file is ~6.2 MB: it repeats the full province and district
 * record inside every one of the 7,452 sub-district entries and carries
 * timestamps, English names and lat/long we do not use. This script strips all
 * of that and de-duplicates provinces and districts into lookup tables, which
 * brings it down to ~143 KB (~58 KB over the wire).
 *
 * Output shape:
 *   {
 *     "source": "...", "license": "MIT", "generatedFrom": "...",
 *     "p": ["กรุงเทพมหานคร", ...],          // provinces
 *     "d": [["เขตพระนคร", 0], ...],          // districts: [name, provinceIndex]
 *     "z": { "10200": [["พระบรมมหาราชวัง", 0], ...] }
 *                                            // postcode -> [[subDistrict, districtIndex]]
 *   }
 */
import { writeFileSync } from "node:fs";

const SOURCE_URL =
  "https://raw.githubusercontent.com/kongvut/thai-province-data/refs/heads/master/api/latest/sub_district_with_district_and_province.json";
const OUT = new URL("../lib/data/thai-postcodes.json", import.meta.url);

const res = await fetch(SOURCE_URL);
if (!res.ok) throw new Error(`Failed to fetch dataset: ${res.status}`);
const rows = await res.json();

const provinces = [];
const provinceIndex = new Map();
const districts = [];
const districtIndex = new Map();
const byPostcode = {};

for (const row of rows) {
  // Upstream soft-deletes rather than removing rows; skip anything retired at
  // any level so the form never offers an abolished area.
  if (row.deleted_at || row.district?.deleted_at || row.district?.province?.deleted_at) {
    continue;
  }

  const provinceName = row.district.province.name_th;
  if (!provinceIndex.has(provinceName)) {
    provinceIndex.set(provinceName, provinces.length);
    provinces.push(provinceName);
  }

  const districtKey = row.district.id;
  if (!districtIndex.has(districtKey)) {
    districtIndex.set(districtKey, districts.length);
    districts.push([row.district.name_th, provinceIndex.get(provinceName)]);
  }

  const zip = String(row.zip_code).padStart(5, "0");
  (byPostcode[zip] ||= []).push([row.name_th, districtIndex.get(districtKey)]);
}

const output = {
  source: "https://github.com/kongvut/thai-province-data",
  license: "MIT",
  generatedFrom: "api/latest/sub_district_with_district_and_province.json",
  generatedAt: new Date().toISOString().slice(0, 10),
  p: provinces,
  d: districts,
  z: byPostcode,
};

writeFileSync(OUT, JSON.stringify(output));
console.log(
  `postcodes=${Object.keys(byPostcode).length} provinces=${provinces.length} ` +
    `districts=${districts.length} bytes=${JSON.stringify(output).length}`,
);
