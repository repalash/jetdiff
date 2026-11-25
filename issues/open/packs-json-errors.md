# A missing packs.json reads as a JSON error

`loadPacksFrom` does not check `res.ok` for `packs.json`, so a 404 shows as a confusing parse error instead of "no packs at this address".
