# Indonesia Polygon Coverage Checklist

Current state after matcher fixes:

- Total MyQuran / Supabase regions: `517`
- Polygon-covered regions: `491`
- Remaining gaps: `26`
- Coverage: `94.97%`

## Completed in current source

- [x] Verify `indonesia_regions.id` already matches the MyQuran area ID.
- [x] Verify the backend already uses polygon lookup first.
- [x] Fix 3 matcher misses caused by naming differences in GADM:
  - `KAB. BATANGHARI`
  - `KOTA BANJARBARU`
  - `KOTA PADANGPANJANG`

## Needs newer district geometry or curated polygons

- [ ] `KAB. PANGANDARAN` (`82161242827b703e6acf9c726942a1e4`) - JAWA BARAT
- [ ] `KAB. MEMPAWAH` (`5737c6ec2e0716f3d8a7a5c4e0de0d9a`) - KALIMANTAN BARAT
- [ ] `KAB. MAHAKAM ULU` (`e7b24b112a44fdd9ee93bdf998c6ca0e`) - KALIMANTAN TIMUR
- [ ] `KAB. PESISIR BARAT` (`8d5e957f297893487bd98fa830fa6413`) - LAMPUNG
- [ ] `KAB. PULAU TALIABU` (`26337353b7962f533d78c762373b3318`) - MALUKU UTARA
- [ ] `KOTA SOFIFI` (`07563a3fe3bbe7e3ba84431ad9d055af`) - MALUKU UTARA
- [ ] `KAB. MALAKA` (`ef0d3930a7b6c95bd2b32ed45989c61f`) - NUSA TENGGARA TIMUR
- [ ] `KAB. YAPEN WAROPEN` (`2b8a61594b1f4c4db0902a8a395ced93`) - PAPUA
- [ ] `KAB. MANOKWARI SELATAN` (`e8c0653fea13f91bf3c48159f7c24f78`) - PAPUA BARAT
- [ ] `KAB. PEGUNUNGAN ARFAK` (`2d6cc4b2d139a53512fb8cbb3086ae2e`) - PAPUA BARAT
- [ ] `KAB. MAMUJU TENGAH` (`d61e4bbd6393c9111e6526ea173a7c8b`) - SULAWESI BARAT
- [ ] `KAB. BANGGAI LAUT` (`b6f0479ae87d244975439c6124592772`) - SULAWESI TENGAH
- [ ] `KAB. MOROWALI UTARA` (`3c7781a36bcd6cf08c11a970fbe0e2a6`) - SULAWESI TENGAH
- [ ] `KAB. BUTON SELATAN` (`bbf94b34eb32268ada57a3be5062fe7d`) - SULAWESI TENGGARA
- [ ] `KAB. BUTON TENGAH` (`4f4adcbf8c6f66dcfc8a3282ac2bf10a`) - SULAWESI TENGGARA
- [ ] `KAB. KOLAKA TIMUR` (`f4f6dce2f3a0f9dada0c2b5b66452017`) - SULAWESI TENGGARA
- [ ] `KAB. KONAWE KEPULAUAN` (`1068c6e4c8051cfd4e9ea8072e3189e2`) - SULAWESI TENGGARA
- [ ] `KAB. MUNA BARAT` (`66808e327dc79d135ba18e051673d906`) - SULAWESI TENGGARA
- [ ] `KAB. MUSI RAWAS UTARA` (`a0a080f42e6f13b3a2df133f073095dd`) - SUMATERA SELATAN
- [ ] `KAB. PENUKAL ABAB LEMATANG ILIR` (`76dc611d6ebaafc66cc0879c71b5db5c`) - SUMATERA SELATAN
- [ ] `KOTA PADANGSIDEMPUAN` (`9a1158154dfa42caddbd0694a4e9bdc8`) - SUMATERA UTARA

## Needs special sub-area / island geometry

- [ ] `PEKAJANG KAB. LINGGA` (`38913e1d6a7b94cb0f55994f679f5956`) - KEPULAUAN RIAU
- [ ] `PULAU LAUT KAB. NATUNA` (`cf67355a3333e6e143439161adc2d82e`) - KEPULAUAN RIAU
- [ ] `PULAU MIDAI KAB. NATUNA` (`63538fe6ef330c13a05a3ed7e599d5f7`) - KEPULAUAN RIAU
- [ ] `PULAU SERASAN KAB. NATUNA` (`ebd9629fc3ae5e9f6611e2ee05a31cef`) - KEPULAUAN RIAU
- [ ] `PULAU TAMBELAN KAB. BINTAN` (`f3f27a324736617f20abbf2ffd806f6d`) - KEPULAUAN RIAU

## Rule for completion

- [ ] Do not mark coverage as 100% until all 26 gaps have a real polygon.
- [ ] Do not reuse parent-district polygons for special island prayer zones.
- [ ] Keep reverse geocode + fuzzy matching only as fallback until all gaps are closed.
