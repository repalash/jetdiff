# Images through the Worker, like GitHub's camo

Later pile (Q14: images load directly for now). Markdown previews load remote images straight from their hosts, which
then see the reader's IP and can track. A Worker route could proxy them: images only, a size cap, an edge cache.
