from PIL import Image, ImageDraw, ImageFont
from pathlib import Path

OUT = Path(__file__).parent
im = Image.new('RGB', (2200, 1790), '#0b1220')
d = ImageDraw.Draw(im)
def font(size, bold=False):
    return ImageFont.truetype('C:/Windows/Fonts/' + ('segoeuib.ttf' if bold else 'segoeui.ttf'), size)
def text(x, y, value, size=25, color='#dce5f4', bold=False):
    d.text((x,y), value, font=font(size,bold), fill=color, spacing=9)
def box(x,y,w,h,title,body,kind='code'):
    colors = {'code':('#142c3b','#43c5db'), 'llm':('#292044','#b69bff'), 'store':('#18372f','#65d6a2'), 'human':('#3b3020','#f4c56b')}
    bg, edge = colors[kind]
    d.rounded_rectangle((x,y,x+w,y+h),radius=18,fill=bg,outline=edge,width=2)
    text(x+20,y+18,title,28,edge,True)
    text(x+20,y+67,body,23)
def arrow(points,color='#7d90ad'):
    d.line(points, fill=color,width=4)
    x,y=points[-1]; px,py=points[-2]
    if x==px:
        k=1 if y>py else -1
        tri=[(x,y),(x-9,y-15*k),(x+9,y-15*k)]
    else:
        k=1 if x>px else -1
        tri=[(x,y),(x-15*k,y-9),(x-15*k,y+9)]
    d.polygon(tri,fill=color)

text(60,32,'CODEBASE INTELLIGENCE',48,bold=True)
text(60,100,'Current implemented architecture  •  Task-specific prompts, shared configured model  •  17 Oct 2026',26,'#9aaec9')
text(60,177,'01   DOCUMENTATION GENERATION',28,'#43c5db',True)
xs=[60,410,760,1110,1460,1810]
nodes=[
('Repository','Local / remote checkout\nFiltered file inventory\nSafe, bounded reads','code'),
('Profile detection','Manifest + source signals\nPackage-level classification\nConfirmed / candidate\nUnknown fallback','code'),
('Evidence + rules','Common reference pages\nProfile requirements\nFunctions, calls, errors\nNumbered source excerpts','code'),
('Wiki generation','Structure + explanation\nSeparate task prompts\nDeclared-source context\nStatic evidence retained','llm'),
('Coverage gate','Zero files → fail\nFailed analysis → fail\nNo complete publication\nwhen generation fails','code'),
('Documentation','Wiki cache + schema\nProfiles + provenance\nSource fingerprints\nReference pages','store')]
for x,(title,body,kind) in zip(xs,nodes):
    box(x,235,310,255,title,body,kind)
for x in xs[:-1]: arrow([(x+310,360),(x+350,360)])
text(70,520,'Profiles: Flutter · React · Next.js · FastAPI · AI · database · RAG candidates. Unknown stacks retain common references.',25,'#9aaec9')
text(70,560,'Generation requests check fingerprints before cache reuse. Profiles are syntax evidence, not proof of runtime behaviour.',24,'#9aaec9')

text(60,655,'02   INTERACTIVE CHAT — DOCUMENT FIRST',28,'#43c5db',True)
box(60,730,390,215,'Chat interface','Next.js UI + FastAPI backend\nUser prompt + chat history\nAnswer / Edit code modes')
box(530,730,390,215,'Developer intent','Latest clarification wins\nRecent user context\nDeterministic concept routing')
box(1000,730,470,215,'Document retrieval','Schema + bounded hybrid search\nBM25 + semantic embeddings\nConcept ranking + source provenance')
box(1550,730,590,215,'Source cross-check','Read only documentation-linked paths\nFocused current lines for answers\nFull admitted snapshots for edit proposals')
for a,b in [(450,530),(920,1000),(1470,1550)]: arrow([(a,835),(b,835)])
arrow([(1965,490),(1965,625),(1235,625),(1235,730)],'#65d6a2')
text(1000,968,'No relevant documents → “No document Found Generate One”',25,'#ffb5a7')
text(1000,1006,'Stop here. No direct codebase-search fallback.',23,'#ffb5a7')

text(60,1090,'03   ANSWER PATH',28,'#b69bff',True)
box(400,1080,400,205,'Generate answer','Chat / research prompt\nDocumentation + live excerpts','llm')
box(900,1080,565,205,'Validate before display','Citation and admitted-line checks\nModel relevance + grounding check\nBounded Ollama correction attempt','code')
box(1565,1080,575,205,'Deliver','Verified answer or clarification\nOtherwise evidence-insufficiency message','store')
arrow([(1845,945),(1845,1050),(600,1050),(600,1080)])
arrow([(800,1180),(900,1180)])
arrow([(1465,1180),(1565,1180)])

text(60,1390,'04   EDIT PATH',28,'#f4c56b',True)
box(400,1370,400,205,'Propose changes','Edit-specific prompt\nStructured edit plan\nRange / snapshot validation','llm')
box(900,1370,565,205,'User review','Equal chat / diff panels\nPending proposal stored in SQLite\nAccept / Reject footer controls','human')
box(1610,1340,530,125,'ACCEPT → Apply','Conflict check → write changes','store')
box(1610,1500,530,125,'REJECT → Keep original','No repository changes applied','human')
arrow([(1550,900),(1510,900),(1510,1325),(600,1325),(600,1370)])
arrow([(800,1470),(900,1470)])
arrow([(1465,1470),(1530,1470),(1530,1400),(1610,1400)],'#65d6a2')
arrow([(1530,1470),(1530,1560),(1610,1560)],'#f4c56b')

text(60,1685,'CYAN  Deterministic processing     PURPLE  Model generation / interpretation     GREEN  Stored or delivered result     GOLD  User decision',23,'#9aaec9')
text(60,1730,'A staged pipeline, not a multi-agent system. Models explain evidence; only explicit acceptance permits edits.',25,'#dce5f4')
im.save(OUT / 'current-architecture.png')
