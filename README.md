# tcg-collection-data

Dati pubblici usati dall'app **TCG Collection** (app non ufficiale, non affiliata a The Pokémon Company, Nintendo, Creatures o Game Freak).

Ogni giorno il workflow `Dati carte (giornaliero)` esegue `tools/build-data.mjs` e pubblica sul branch `data` file JSON con elenchi di set e carte (solo testo e collegamenti alle fonti, nessuna immagine):

- set e carte giapponesi (fonte: TCGCSV / TCGplayer), abbinati a TCGdex dove possibile
- set europei nuovi, immagini mancanti, versioni speciali (Poké Ball, Master Ball…)

Fonti: [TCGdex](https://tcgdex.dev) (MIT), [TCGCSV](https://tcgcsv.com).
