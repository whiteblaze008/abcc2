const express=require('express'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const app=express();app.set('trust proxy',1);app.use(express.json({limit:'200kb'}));app.use(express.static('public'));
const F=path.join(process.env.DATA_DIR||__dirname,'data.json');
const UPI='9313467169@ptsbi',PW=process.env.ADMIN_PASSWORD||'changeme',HOLD=900;
let db={match:{date:'Saturday, 10 October',time:'9:00 PM – 11:00 PM',venue:'Bopal, Ahmedabad',maps:'',price:250,max:16,open:true},bookings:[],history:[]};
try{db={...db,...JSON.parse(fs.readFileSync(F,'utf8'))}}catch(e){}
const save=()=>{try{fs.writeFileSync(F+'.tmp',JSON.stringify(db));fs.renameSync(F+'.tmp',F)}catch(e){console.error(e.message)}};
const age=b=>(Date.now()-new Date(b.at))/1000;
const live=b=>b.status==='confirmed'||b.status==='pending'||(b.status==='held'&&age(b)<HOLD);
const sum=f=>db.bookings.filter(f).reduce((a,b)=>a+b.players,0);
const info=()=>{const reserved=sum(live),confirmed=sum(b=>b.status==='confirmed');return{...db.match,confirmed,reserved,left:Math.max(0,db.match.max-reserved)}};
const pub=b=>{const secs=Math.max(0,Math.floor(HOLD-age(b)));return{id:b.id,status:b.status==='held'&&!secs?'expired':b.status,players:b.players,amount:b.amount,mobile:b.mobile,secs}};
const hits={};const limited=ip=>{const t=Date.now(),a=hits[ip]=(hits[ip]||[]).filter(x=>t-x<6e5);a.push(t);return a.length>8};

app.get('/api/match',(q,r)=>{const recent=[...new Set(db.bookings.filter(b=>b.status==='confirmed'&&b.name!=='Player').map(b=>b.name.split(' ')[0]))].slice(-3);r.json({...info(),upi:UPI,recent,played:db.history.reduce((a,h)=>a+h.players,0)})});
app.get('/api/booking/:id',(q,r)=>{const b=db.bookings.find(x=>x.id===q.params.id);b?r.json(pub(b)):r.status(404).json({error:'Booking not found'})});
app.post('/api/book',(q,r)=>{
  if(limited(q.ip))return r.status(429).json({error:'Too many attempts. Please try again in a few minutes.'});
  const name=String(q.body.name||'').trim().slice(0,60)||'Player',mobile=String(q.body.mobile||'').trim(),n=parseInt(q.body.players,10),names=String(q.body.names||'').trim().slice(0,400),m=db.match;
  if(!/^[6-9]\d{9}$/.test(mobile)||!(n>=1))return r.status(400).json({error:'Enter a valid 10-digit mobile number.'});
  if(!m.open)return r.status(400).json({error:'Bookings are closed for this match.'});
  const left=m.max-sum(live);if(n>left)return r.status(400).json({error:left>0?`Only ${left} slot(s) left.`:'This match is full.'});
  const b={id:'ABCC-'+crypto.randomBytes(4).toString('hex').toUpperCase(),name,mobile,players:n,amount:n*m.price,names,status:'held',at:new Date().toISOString()};
  db.bookings.push(b);save();r.json(pub(b));
});
app.post('/api/paid',(q,r)=>{
  const b=db.bookings.find(x=>x.id===q.body.id);if(!b)return r.status(404).json({error:'Booking not found'});
  if(b.status==='held'){if(!live(b)&&sum(live)+b.players>db.match.max)return r.status(400).json({error:'Your hold expired and the slots were taken. We will contact you for a refund if you paid.'});b.status='pending';b.paidAt=new Date().toISOString();save()}
  r.json(pub(b));
});
app.post('/api/cancel',(q,r)=>{const b=db.bookings.find(x=>x.id===q.body.id);if(b&&b.status==='held'){b.status='cancelled';save()}r.json({ok:1})});

const same=(a,b)=>crypto.timingSafeEqual(crypto.createHash('sha256').update(String(a)).digest(),crypto.createHash('sha256').update(b).digest());
const auth=(q,r,n)=>same(q.headers['x-admin']||'',PW)?n():r.status(401).json({error:'Wrong password'});
app.get('/api/admin',auth,(q,r)=>r.json({match:info(),bookings:db.bookings.filter(b=>b.status!=='cancelled'),history:db.history,weak:PW==='changeme'}));
app.post('/api/admin/status',auth,(q,r)=>{const b=db.bookings.find(x=>x.id===q.body.id);if(!b||!['confirmed','pending','rejected'].includes(q.body.status))return r.status(400).json({error:'Invalid'});b.status=q.body.status;save();r.json({ok:1})});
app.post('/api/admin/match',auth,(q,r)=>{const m=q.body,o=db.match;db.match={date:m.date||o.date,time:m.time||o.time,venue:m.venue||o.venue,maps:m.maps||'',startsAt:m.startsAt||'',price:parseInt(m.price,10)||o.price,max:parseInt(m.max,10)||16,open:!!m.open};save();r.json({ok:1})});
app.post('/api/admin/next',auth,(q,r)=>{const i=info();db.history.unshift({date:db.match.date,players:i.confirmed,revenue:i.confirmed*db.match.price,bookings:db.bookings.length});db.bookings=[];save();r.json({ok:1})});
app.get('/api/admin/backup',auth,(q,r)=>r.json(db));
app.post('/api/admin/restore',auth,(q,r)=>{const d=q.body;if(!d||!d.match||!Array.isArray(d.bookings))return r.status(400).json({error:'Not a valid backup file'});db={history:[],...d};save();r.json({ok:1})});
app.listen(process.env.PORT||3000,()=>console.log('ABCC running'));
