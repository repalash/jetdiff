# A snapshot index that failed to load is never retried

When `index.json` of a snapshot fails to load (offline on the first visit, a network error), the failure is kept until `setSnapshot` is called, so the page keeps answering "not in this snapshot" after the network is back.
