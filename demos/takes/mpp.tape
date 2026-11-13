Output "demos/takes/v1-mpp-take.mp4"
Set Shell bash
Set FontFamily "Menlo"
Set FontSize 26
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
Type "pay http://127.0.0.1:8402/premium"
Enter
Wait+Screen@480s /Settlement:/
Sleep 2s
