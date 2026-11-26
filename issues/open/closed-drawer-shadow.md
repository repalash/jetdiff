# On a phone, the closed drawer's shadow shows at the left edge

The closed `.side` drawer is moved out with `translateX(-102%)`, but its `box-shadow: 4px 0 24px` reaches further than
the 2%, so a grey band stays along the left edge of the diff and the Timeline (most visible in the light themes).
