# Monaco's WebKit clipboard workaround logs errors in phone emulation

Monaco 0.57 arms a clipboard write on every click and key press in the editor when it takes the browser for Safari or a
WebKit view (`installWebKitWriteTextWorkaround` in its clipboard service). Chromium with an iPhone user agent (the
tests' and screenshots' phone) refuses the write, and Monaco logs `NotAllowedError: Failed to execute 'write' on
'Clipboard'` for each one. On Safari the pending write is cancelled and nothing is logged, but that is not checked:
try a real iPhone and desktop Safari (selecting, copying, editing) and see that no prompt or error appears.
