# tcg-collection-data

Dati pubblici usati dall'app **TCG Collection**: app non ufficiale, non affiliata ai titolari dei giochi di carte o dei marchi citati nei dati.

Ogni giorno il workflow `Dati carte (giornaliero)` aggiorna il branch `data` con file JSON (solo testo, numeri e collegamenti alle fonti, nessuna immagine):

- set e carte giapponesi, abbinati a TCGdex dove possibile
- set europei nuovi, immagini mancanti, versioni speciali dei set
- impronte numeriche delle immagini (`fp/`), usate dall'app per riconoscere le carte con la fotocamera

Il file `admin/config.json` (branch `main`) contiene i set nascosti nell'app.

Fonti: [TCGdex](https://tcgdex.dev) (MIT), [TCGCSV](https://tcgcsv.com).
