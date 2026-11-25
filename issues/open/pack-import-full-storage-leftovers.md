# A pack import stopped by a full storage leaves its files

`importPack` writes a pack's files before its index; when the storage fills up on the way, the files written stay in
`jd-pack` with no index listing them. They go with Remove all saved data only.
