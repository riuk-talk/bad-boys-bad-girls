# Extracts the card faces from the official French rules PDF (pip install opencv-python-headless; poppler-utils).
# Usage: python3 extract_cards.py OUT_DIR [card names]. Positions are in 300 dpi pixels of each page.
import cv2, numpy as np, subprocess, os, sys
PDF="/root/.claude/uploads/fca525ab-a73b-591d-a673-ee2b3aa5e76b/1815a758-flip_7_fr.pdf"
OUT=sys.argv[1]; os.makedirs(OUT,exist_ok=True)
TMP=OUT+"/_tmp"; os.makedirs(TMP,exist_ok=True)
TARGET_W=600
# name: (page, x0,y0,x1,y1 at 300dpi)
CARDS={
 "n0":(5,525,90,675,290), "n1":(2,510,650,620,845), "n2":(4,190,1395,335,1595),
 "n3":(6,55,1540,142,1655), "n4":(6,743,1540,830,1655), "n5":(6,285,1540,372,1655),
 "n6":(4,745,730,980,1040), "n7":(6,398,1540,485,1655), "n8":(4,725,185,950,485),
 "n9":(6,627,1540,714,1655), "n10":(6,513,1540,600,1655), "n11":(6,170,1540,257,1655),
 "n12":(4,795,1355,940,1555),
 "x2":(2,50,1105,195,1305), "p2":(2,218,1105,363,1305), "p4":(2,386,1105,531,1305),
 "p6":(2,555,1105,700,1305), "p8":(2,723,1105,868,1305), "p10":(2,892,1105,1037,1305),
 "stop":(2,60,1458,205,1658), "second":(2,275,1458,420,1658), "flip3":(2,488,1458,633,1658),
}
def navy_mask(img):
    b,g,r=[img[:,:,i].astype(int) for i in range(3)]
    return ((b>80)&(r<100)&(g<90)&(b-r>35)&(b-g>35)).astype(np.uint8)
only=sys.argv[2:] or CARDS.keys()
for name in only:
    pg,x0,y0,x1,y1=CARDS[name]
    w300=x1-x0; dpi=int(300*TARGET_W/(w300*0.92))
    s=dpi/300
    pad=0.06
    X0=int((x0-w300*pad)*s); Y0=int((y0-(y1-y0)*pad)*s); W=int(w300*(1+2*pad)*s); H=int((y1-y0)*(1+2*pad)*s)
    base=f"{TMP}/{name}"
    subprocess.run(["pdftoppm","-r",str(dpi),"-f",str(pg),"-l",str(pg),"-x",str(X0),"-y",str(Y0),"-W",str(W),"-H",str(H),"-png","-singlefile",PDF,base],check=True)
    img=cv2.imread(base+".png"); m=navy_mask(img)
    h,w=m.shape; best=None
    for ang in np.arange(-14,14.01,0.25):
        M=cv2.getRotationMatrix2D((w/2,h/2),ang,1); r=cv2.warpAffine(m,M,(w,h))
        cs=r.sum(0); rs=r.sum(1)
        L=cs[:w//3].max(); R=cs[2*w//3:].max(); T=rs[:h//3].max(); B=rs[2*h//3:].max()
        sc=L+R+T+B
        if best is None or sc>best[0]: best=(sc,ang)
    ang=best[1]
    M=cv2.getRotationMatrix2D((w/2,h/2),ang,1)
    rimg=cv2.warpAffine(img,M,(w,h),flags=cv2.INTER_CUBIC,borderValue=(213,248,255))
    r=navy_mask(rimg); cs=r.sum(0).astype(float); rs=r.sum(1).astype(float)
    def edge(arr,lo,hi,outer_first):
        seg=arr[lo:hi]; thr=seg.max()*0.6; idx=np.where(seg>=thr)[0]+lo
        return idx.min() if outer_first else idx.max()
    l=edge(cs,0,w//3,True); rr=edge(cs,2*w//3,w,False); t=edge(rs,0,h//3,True); b=edge(rs,2*h//3,h,False)
    crop=rimg[t:b+1,l:rr+1]
    ch,cw=crop.shape[:2]
    # rounded-corner alpha mask
    rad=int(cw*0.045); ss=4
    mk=np.zeros((ch*ss,cw*ss),np.uint8)
    cv2.rectangle(mk,(rad*ss,0),((cw-rad)*ss,ch*ss),255,-1); cv2.rectangle(mk,(0,rad*ss),(cw*ss,(ch-rad)*ss),255,-1)
    for cx,cy in [(rad,rad),(cw-rad,rad),(rad,ch-rad),(cw-rad,ch-rad)]: cv2.circle(mk,(cx*ss,cy*ss),rad*ss,255,-1)
    mk=cv2.resize(mk,(cw,ch),interpolation=cv2.INTER_AREA)
    rgba=cv2.cvtColor(crop,cv2.COLOR_BGR2BGRA); rgba[:,:,3]=mk
    rgba=cv2.resize(rgba,(500,700),interpolation=cv2.INTER_AREA)
    cv2.imwrite(f"{OUT}/{name}.png",rgba)
    print(name,f"angle={ang:.2f}",f"crop={cw}x{ch}",f"ratio={cw/ch:.3f}")
