# The "1" card is partly covered by the "8" in the PDF: rebuild its hidden left side by mirroring (the frame is symmetric).
# Usage: python3 rebuild_card_1.py WORK_DIR (expects WORK_DIR/cut/_tmp/n1.png from extract_cards.py).
import cv2, numpy as np, sys
D=sys.argv[1]
img=cv2.imread(D+"/cut/_tmp/n1.png"); h,w=img.shape[:2]
b,g,r=[img[:,:,i].astype(int) for i in range(3)]
m=((b>80)&(r<100)&(g<90)&(b-r>35)&(b-g>35)).astype(np.uint8)
rows=m[:,300:650].sum(1); cols=m[150:1150,:].sum(0)
top=np.where(rows[:h//3]>=rows[:h//3].max()*0.6)[0].min()
bot=np.where(rows[2*h//3:]>=rows[2*h//3:].max()*0.6)[0].max()+2*h//3
seg=cols[500:720]; right=np.where(seg>=seg.max()*0.6)[0].max()+500
H=bot-top+1; W=int(round(H*0.7173)); left=right-W+1; cx=(left+right)/2
cut=int(np.where(cols[40:200]>=cols[40:200].max()*0.6)[0].max()+40)+18  # just right of the covering card border
print(top,bot,right,left,cx,cut)
canvas=np.zeros((H,W,3),np.uint8)
for X in range(W):
    wx=left+X
    src=wx if wx>=cut else int(round(2*cx-wx))
    canvas[:,X]=img[top:bot+1,src]
ch,cw=H,W; rad=int(cw*0.045); ss=4
mk=np.zeros((ch*ss,cw*ss),np.uint8)
cv2.rectangle(mk,(rad*ss,0),((cw-rad)*ss,ch*ss),255,-1); cv2.rectangle(mk,(0,rad*ss),(cw*ss,(ch-rad)*ss),255,-1)
for x,y in [(rad,rad),(cw-rad,rad),(rad,ch-rad),(cw-rad,ch-rad)]: cv2.circle(mk,(x*ss,y*ss),rad*ss,255,-1)
mk=cv2.resize(mk,(cw,ch),interpolation=cv2.INTER_AREA)
rgba=cv2.cvtColor(canvas,cv2.COLOR_BGR2BGRA); rgba[:,:,3]=mk
cv2.imwrite(D+"/cut/n1.png",cv2.resize(rgba,(500,700),interpolation=cv2.INTER_AREA))
