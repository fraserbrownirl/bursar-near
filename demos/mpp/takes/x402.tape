Output "demos/takes/v1-x402-take.mp4"
Set Shell bash
Set FontFamily "Menlo"
Set FontSize 31
Set Width 1920
Set Height 1080
Set Padding 8
Set Framerate 30
Hide
Type "bursar"
Enter
Wait+Screen@90s /I am ready\./
Sleep 300ms
Show
Type "what's the weather in London?"
Enter
Wait+Screen@180s /Which one/
Sleep 500ms
Type "one"
Enter
Wait+Screen@240s /basescan\.org\/tx\//
Wait+Screen@90s /London: /
Sleep 2s
