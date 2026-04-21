import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase.js";

const CATEGORIES = {
  hogar: { label:"Hogar", icon:"🏠", color:"#3266ad", subcats:["Luz","Gas","Agua","Internet","TV Streaming","Impuesto Municipal","Impuesto Provincial","Seguro Hogar","Vigilancia","Monitoreo de Puerta","Otros"] },
  autos: { label:"Autos", icon:"🚗", color:"#d85a30", subcats:["VW Polo - Seguro","VW Polo - Combustible","VW Polo - Mecánico","VW Polo - Service","VW Gol - Seguro","VW Gol - Combustible","VW Gol - Mecánico","VW Gol - Service"] },
  hijos: { label:"Hijos", icon:"🧑‍🧑‍🧒‍🧒", color:"#1d9e75", subcats:["Colegio","Actividades","Otros"] }
};
const MEDIOS = ["Débito automático","Transferencia","Efectivo","Tarjeta de crédito"];
const MONTHS_FULL = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const TABS = ["Dashboard","Gastos","Calendario","Análisis"];
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

function genId() { return Math.random().toString(36).slice(2,10); }
function fmt(n) { return new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0}).format(n||0); }

const badgeStyle = (pagado) => ({
  display:"inline-flex", alignItems:"center", gap:4, fontSize:11,
  padding:"3px 10px", borderRadius:20, cursor:"pointer", fontWeight:500, userSelect:"none",
  background: pagado ? "#1d9e7522" : "#e24b4a22",
  color: pagado ? "#0f6e56" : "#a32d2d",
  border: `0.5px solid ${pagado?"#1d9e75":"#e24b4a"}44`,
  whiteSpace:"nowrap"
});

function Login() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleLogin = async () => {
    setLoading(true); setError("");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError("Email o contraseña incorrectos");
    setLoading(false);
  };

  return (
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#f5f5f5"}}>
      <div style={{background:"#fff",borderRadius:16,padding:"2rem",width:340,boxShadow:"0 2px 16px rgba(0,0,0,0.08)"}}>
        <h1 style={{fontSize:22,fontWeight:500,margin:"0 0 4px"}}>Gastos del Hogar</h1>
        <p style={{fontSize:13,color:"#666",margin:"0 0 1.5rem"}}>Ingresá con tu cuenta</p>
        <label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Email</label>
        <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="tu@email.com" style={{width:"100%",padding:"8px 12px",borderRadius:8,border:"1px solid #ddd",fontSize:14,marginBottom:12,boxSizing:"border-box"}}/>
        <label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Contraseña</label>
        <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="••••••••" onKeyDown={e=>e.key==="Enter"&&handleLogin()} style={{width:"100%",padding:"8px 12px",borderRadius:8,border:"1px solid #ddd",fontSize:14,marginBottom:16,boxSizing:"border-box"}}/>
        {error && <p style={{fontSize:12,color:"#e24b4a",margin:"0 0 12px"}}>{error}</p>}
        <button onClick={handleLogin} disabled={loading} style={{width:"100%",padding:"10px",background:"#3266ad",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:14,fontWeight:500}}>
          {loading ? "Ingresando..." : "Ingresar"}
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(null);
  const [loadingSession, setLoadingSession] = useState(true);
  const [tab, setTab] = useState("Dashboard");
  const [expenses, setExpenses] = useState([]);
  const [loadingData, setLoadingData] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [form, setForm] = useState({category:"hogar",subcat:"Luz",amount:"",date:new Date().toISOString().slice(0,10),desc:"",dueDate:"",recurring:false,fileName:"",medio:"Transferencia",pagado:false});
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [filterCat, setFilterCat] = useState("all");
  const [filterMonth, setFilterMonth] = useState("all");
  const [filterPagado, setFilterPagado] = useState("all");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const fileRef = useRef();
  const importRef = useRef();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session); setLoadingSession(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => { if (session) loadExpenses(); }, [session]);

  const loadExpenses = async () => {
    setLoadingData(true);
    const { data, error } = await supabase.from("gastos").select("*").order("created_at", { ascending: false });
    if (!error && data) {
      setExpenses(data.map(e => ({
        id: String(e.id), category: e.category, subcat: e.subcat,
        amount: e.amount, date: e.date, dueDate: e.due_date,
        desc: e.descripcion, medio: e.medio, pagado: e.pagado,
        recurring: e.recurring, fileName: e.file_name
      })));
    }
    setLoadingData(false);
  };

  const handleImportCSV = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setImportMsg("Importando...");
    const text = await f.text();
    const lines = text.split("\n").filter(l => l.trim());
    const rows = lines.slice(1).map(line => {
      const cols = line.split(",").map(c => c.replace(/^"|"$/g,"").trim());
      return {
        category: cols[1]==="Hogar"?"hogar":cols[1]==="Autos"?"autos":"hijos",
        subcat: cols[2], descripcion: cols[3],
        amount: parseFloat(cols[4])||0,
        date: cols[5]?.includes("/")?cols[5].split("/").reverse().join("-"):cols[5],
        due_date: cols[6]?.includes("/")?cols[6].split("/").reverse().join("-"):(cols[6]||null),
        medio: cols[7], pagado: cols[8]==="Pagado",
        recurring: cols[9]==="Sí", file_name: cols[10]||""
      };
    }).filter(r => r.subcat && r.amount);
    const { error } = await supabase.from("gastos").insert(rows);
    if (error) { setImportMsg("Error al importar: " + error.message); }
    else { setImportMsg(`✓ ${rows.length} gastos importados`); loadExpenses(); }
    setTimeout(() => setImportMsg(""), 4000);
  };

  const togglePagado = async (id) => {
    const e = expenses.find(x => x.id === id);
    await supabase.from("gastos").update({ pagado: !e.pagado }).eq("id", id);
    setExpenses(p => p.map(x => x.id === id ? {...x, pagado: !x.pagado} : x));
  };

  const wakeBackend = async () => { try { await fetch(`${API_URL}/`); } catch {} };

  const handleFile = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setForm(p=>({...p,fileName:f.name}));
    if (f.type==="application/pdf" || f.type.startsWith("image/")) {
      setAiLoading(true); setAiResult("Despertando servidor...");
      await wakeBackend();
      setAiResult("Analizando archivo con IA...");
      try {
        const b64 = await new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result.split(",")[1]); r.onerror=rej; r.readAsDataURL(f); });
        let parsed = null;
        for (let intento = 1; intento <= 3; intento++) {
          try {
            setAiResult(`Analizando... (intento ${intento}/3)`);
            const resp = await fetch(`${API_URL}/api/analyze`, {
              method:"POST", headers:{"Content-Type":"application/json"},
              body: JSON.stringify({ base64: b64, mediaType: f.type }),
              signal: AbortSignal.timeout(60000)
            });
            parsed = await resp.json(); break;
          } catch { if (intento < 3) await new Promise(r => setTimeout(r, 3000)); }
        }
        if (parsed && !parsed.error) {
          setAiResult("✓ " + (parsed.descripcion || "Archivo procesado"));
          setForm(prev=>({...prev,
            amount: parsed.monto ? String(parsed.monto) : prev.amount,
            date: parsed.fecha || prev.date, dueDate: parsed.vencimiento || prev.dueDate,
            desc: parsed.descripcion || prev.desc, subcat: parsed.categoria_sugerida || prev.subcat,
            category: parsed.foco_sugerido || prev.category,
          }));
        } else { setAiResult("No se pudo extraer datos. Completá manualmente."); }
      } catch { setAiResult("Error procesando el archivo."); }
      setAiLoading(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.amount || !form.date) return;
    const row = {
      category: form.category, subcat: form.subcat, amount: parseFloat(form.amount),
      date: form.date, due_date: form.dueDate || null, descripcion: form.desc,
      medio: form.medio, pagado: form.pagado, recurring: form.recurring, file_name: form.fileName
    };
    if (editId) {
      await supabase.from("gastos").update(row).eq("id", editId);
      setExpenses(p => p.map(e => e.id === editId ? {...form, id: editId, amount: parseFloat(form.amount)} : e));
      setEditId(null);
    } else {
      const { data } = await supabase.from("gastos").insert(row).select();
      if (data?.[0]) setExpenses(p => [{...form, id: String(data[0].id), amount: parseFloat(form.amount)}, ...p]);
    }
    setForm({category:"hogar",subcat:"Luz",amount:"",date:new Date().toISOString().slice(0,10),desc:"",dueDate:"",recurring:false,fileName:"",medio:"Transferencia",pagado:false});
    setAiResult(""); setShowForm(false);
  };

  const del = async (id) => {
    await supabase.from("gastos").delete().eq("id", id);
    setExpenses(p => p.filter(e => e.id !== id));
  };

  const edit = (e) => { setForm({...e, amount: String(e.amount)}); setEditId(e.id); setShowForm(true); };

  const filtered = expenses.filter(e => {
    const mc = filterCat==="all"||e.category===filterCat;
    const mm = filterMonth==="all"||e.date?.startsWith(`${new Date().getFullYear()}-${String(filterMonth).padStart(2,"0")}`);
    const mp = filterPagado==="all"||(filterPagado==="pagado"&&e.pagado)||(filterPagado==="pendiente"&&!e.pagado);
    return mc&&mm&&mp;
  });

  const totalByCat = (cat) => expenses.filter(e=>e.category===cat).reduce((s,e)=>s+e.amount,0);
  const totalAll = expenses.reduce((s,e)=>s+e.amount,0);
  const totalPagado = expenses.filter(e=>e.pagado).reduce((s,e)=>s+e.amount,0);
  const totalPendiente = expenses.filter(e=>!e.pagado).reduce((s,e)=>s+e.amount,0);

  const monthlyTotals = () => {
    const map={};
    expenses.forEach(e=>{ const m=e.date?.slice(0,7); if(m) map[m]=(map[m]||0)+e.amount; });
    return Object.entries(map).sort(([a],[b])=>a.localeCompare(b)).slice(-6);
  };

  const exportExcel = () => {
    const rows=[["ID","Foco","Subcategoría","Descripción","Monto","Fecha","Vencimiento","Medio de Pago","Estado","Recurrente"]];
    expenses.forEach(e=>rows.push([e.id,CATEGORIES[e.category]?.label,e.subcat,e.desc,e.amount,e.date,e.dueDate,e.medio,e.pagado?"Pagado":"Pendiente",e.recurring?"Sí":"No"]));
    const csv=rows.map(r=>r.map(c=>`"${c||""}"`).join(",")).join("\n");
    const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob); a.download="gastos_hogar.csv"; a.click();
  };

  const getDueDates = () => {
    const result={};
    expenses.forEach(e=>{ const d=e.dueDate||e.date; if(!d)return; const day=parseInt(d.slice(8,10)); const key=`${calYear}-${String(calMonth+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`; if(!result[key])result[key]=[]; result[key].push(e); });
    return result;
  };

  const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
  const firstDay=new Date(calYear,calMonth,1).getDay();
  const dueDates=getDueDates();

  const subCatTotals = () => {
    const map={};
    filtered.forEach(e=>{ const k=`${e.category}__${e.subcat}`; map[k]=(map[k]||0)+e.amount; });
    return Object.entries(map).sort(([,a],[,b])=>b-a).slice(0,8);
  };

  if (loadingSession) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",fontSize:14,color:"#666"}}>Cargando...</div>;
  if (!session) return <Login />;

  return (
    <div style={{fontFamily:"system-ui,sans-serif",maxWidth:920,margin:"0 auto",padding:"1rem",color:"#1a1a1a"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.5rem",flexWrap:"wrap",gap:8}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:500,margin:0}}>Gastos del Hogar</h1>
          <p style={{fontSize:12,color:"#666",margin:"2px 0 0"}}>{session.user.email}</p>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <input ref={importRef} type="file" accept=".csv" onChange={handleImportCSV} style={{display:"none"}}/>
          <button onClick={()=>importRef.current.click()} style={{fontSize:13,padding:"6px 14px",background:"#f5f5f5",border:"1px solid #ddd",borderRadius:8,cursor:"pointer"}}>↑ Importar CSV</button>
          {importMsg && <span style={{fontSize:12,color:importMsg.startsWith("✓")?"#1d9e75":"#e24b4a",alignSelf:"center"}}>{importMsg}</span>}
          <button onClick={exportExcel} style={{fontSize:13,padding:"6px 14px",background:"#f5f5f5",border:"1px solid #ddd",borderRadius:8,cursor:"pointer"}}>↓ Excel</button>
          <button onClick={()=>supabase.auth.signOut()} style={{fontSize:13,padding:"6px 14px",background:"#f5f5f5",border:"1px solid #ddd",borderRadius:8,cursor:"pointer"}}>Salir</button>
          <button onClick={()=>{setShowForm(true);setEditId(null);setAiResult("");setForm({category:"hogar",subcat:"Luz",amount:"",date:new Date().toISOString().slice(0,10),desc:"",dueDate:"",recurring:false,fileName:"",medio:"Transferencia",pagado:false});}} style={{fontSize:13,padding:"6px 14px",background:"#3266ad",border:"none",borderRadius:8,cursor:"pointer",color:"#fff",fontWeight:500}}>+ Nuevo Gasto</button>
        </div>
      </div>

      <div style={{display:"flex",gap:4,marginBottom:"1.5rem",borderBottom:"1px solid #eee"}}>
        {TABS.map(t=>(
          <button key={t} onClick={()=>setTab(t)} style={{padding:"8px 18px",fontSize:14,background:"none",border:"none",borderBottom:tab===t?"2px solid #3266ad":"2px solid transparent",color:tab===t?"#3266ad":"#666",cursor:"pointer",fontWeight:tab===t?500:400}}>{t}</button>
        ))}
      </div>

      {showForm && (
        <div style={{background:"#fff",border:"1px solid #e0e0e0",borderRadius:12,padding:"1.25rem",marginBottom:"1.5rem"}}>
          <h3 style={{margin:"0 0 1rem",fontSize:16,fontWeight:500}}>{editId?"Editar gasto":"Nuevo gasto"}</h3>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            {[["Foco","select-cat"],["Categoría","select-sub"],["Monto ($)","amount"],["Fecha de pago","date"],["Fecha de vencimiento","dueDate"],["Descripción","desc"],["Medio de pago","select-medio"],["Estado","select-pagado"]].map(([lbl,field])=>(
              <div key={field}>
                <label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>{lbl}</label>
                {field==="select-cat" && <select value={form.category} onChange={e=>setForm(p=>({...p,category:e.target.value,subcat:CATEGORIES[e.target.value].subcats[0]}))} style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}>
                  {Object.entries(CATEGORIES).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}
                </select>}
                {field==="select-sub" && <select value={form.subcat} onChange={e=>setForm(p=>({...p,subcat:e.target.value}))} style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}>
                  {CATEGORIES[form.category].subcats.map(s=><option key={s}>{s}</option>)}
                </select>}
                {field==="select-medio" && <select value={form.medio} onChange={e=>setForm(p=>({...p,medio:e.target.value}))} style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}>
                  {MEDIOS.map(m=><option key={m}>{m}</option>)}
                </select>}
                {field==="select-pagado" && <select value={form.pagado?"1":"0"} onChange={e=>setForm(p=>({...p,pagado:e.target.value==="1"}))} style={{width:"100%",padding:"7px 10px",borderRadius:8,border:`1px solid ${form.pagado?"#1d9e75":"#e24b4a"}`,fontSize:14,background:form.pagado?"#f0faf5":"#fef2f2",color:form.pagado?"#0f6e56":"#a32d2d",fontWeight:500,boxSizing:"border-box"}}>
                  <option value="0">🔴 Pendiente</option>
                  <option value="1">🟢 Pagado</option>
                </select>}
                {field==="amount" && <input type="number" value={form.amount} onChange={e=>setForm(p=>({...p,amount:e.target.value}))} placeholder="0" style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}/>}
                {field==="date" && <input type="date" value={form.date} onChange={e=>setForm(p=>({...p,date:e.target.value}))} style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}/>}
                {field==="dueDate" && <input type="date" value={form.dueDate} onChange={e=>setForm(p=>({...p,dueDate:e.target.value}))} style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}/>}
                {field==="desc" && <input type="text" value={form.desc} onChange={e=>setForm(p=>({...p,desc:e.target.value}))} placeholder="Ej: Factura Edesur Febrero" style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}/>}
              </div>
            ))}
          </div>
          <div style={{marginTop:12}}>
            <label style={{fontSize:12,color:"#666"}}>
              <input type="checkbox" checked={form.recurring} onChange={e=>setForm(p=>({...p,recurring:e.target.checked}))} style={{marginRight:4}}/>
              Gasto recurrente mensual
            </label>
          </div>
          <div style={{marginTop:12}}>
            <label style={{fontSize:12,color:"#666",display:"block",marginBottom:6}}>Adjuntar factura o resumen (PDF o imagen)</label>
            <input ref={fileRef} type="file" accept=".pdf,image/*" onChange={handleFile} style={{display:"none"}}/>
            <button onClick={()=>fileRef.current.click()} disabled={aiLoading} style={{fontSize:13,padding:"6px 14px",background:"#f5f5f5",border:"1px solid #ddd",borderRadius:8,cursor:"pointer"}}>
              {form.fileName?`📎 ${form.fileName}`:"📎 Subir archivo"}
            </button>
            {aiLoading && <span style={{fontSize:12,color:"#3266ad",marginLeft:12}}>⏳ {aiResult}</span>}
            {!aiLoading && aiResult && <span style={{fontSize:12,color:aiResult.startsWith("✓")?"#1d9e75":"#e24b4a",marginLeft:12}}>{aiResult}</span>}
          </div>
          <div style={{display:"flex",gap:8,marginTop:"1rem"}}>
            <button onClick={handleSubmit} style={{padding:"8px 20px",background:"#3266ad",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:14,fontWeight:500}}>{editId?"Guardar cambios":"Agregar gasto"}</button>
            <button onClick={()=>{setShowForm(false);setEditId(null);}} style={{padding:"8px 16px",background:"none",border:"1px solid #ddd",borderRadius:8,cursor:"pointer",fontSize:14,color:"#666"}}>Cancelar</button>
          </div>
        </div>
      )}

      {tab==="Dashboard" && (
        <div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:"1rem"}}>
            {[["Total general",totalAll,"#3266ad"],["Pagado",totalPagado,"#1d9e75"],["Pendiente",totalPendiente,"#e24b4a"]].map(([l,v,c])=>(
              <div key={l} style={{background:"#f9f9f9",borderRadius:8,padding:"1rem",textAlign:"center"}}>
                <p style={{fontSize:12,color:"#666",margin:"0 0 4px"}}>{l}</p>
                <p style={{fontSize:20,fontWeight:500,margin:0,color:c}}>{fmt(v)}</p>
              </div>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:"1.5rem"}}>
            {Object.entries(CATEGORIES).map(([k,v])=>{
              const cats=expenses.filter(e=>e.category===k);
              const total=cats.reduce((s,e)=>s+e.amount,0);
              const pagado=cats.filter(e=>e.pagado).reduce((s,e)=>s+e.amount,0);
              const bySub={};
              cats.forEach(e=>{bySub[e.subcat]=(bySub[e.subcat]||0)+e.amount;});
              const top=Object.entries(bySub).sort(([,a],[,b])=>b-a).slice(0,4);
              return (
                <div key={k} style={{background:"#fff",border:"1px solid #eee",borderRadius:12,padding:"1.25rem"}}>
                  <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:6}}>
                    <span style={{fontSize:18}}>{v.icon}</span>
                    <span style={{fontWeight:500,fontSize:15}}>{v.label}</span>
                  </div>
                  <p style={{fontSize:20,fontWeight:500,margin:"0 0 4px",color:v.color}}>{fmt(total)}</p>
                  <div style={{display:"flex",gap:8,marginBottom:10,fontSize:11}}>
                    <span style={{color:"#0f6e56"}}>✓ {fmt(pagado)}</span>
                    <span style={{color:"#a32d2d"}}>● {fmt(total-pagado)}</span>
                  </div>
                  {top.length===0&&<p style={{fontSize:12,color:"#999"}}>Sin gastos</p>}
                  {top.map(([sub,amt])=>(
                    <div key={sub} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"3px 0",borderBottom:"1px solid #f0f0f0"}}>
                      <span style={{color:"#666",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"65%"}}>{sub}</span>
                      <span style={{fontWeight:500}}>{fmt(amt)}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <div style={{background:"#fff",border:"1px solid #eee",borderRadius:12,padding:"1.25rem",marginBottom:"1.5rem"}}>
            <h3 style={{margin:"0 0 1rem",fontSize:15,fontWeight:500}}>Evolución mensual</h3>
            {monthlyTotals().length===0
              ? <p style={{fontSize:13,color:"#999"}}>Agregá gastos para ver la evolución.</p>
              : <div style={{display:"flex",alignItems:"flex-end",gap:8,height:120}}>
                  {monthlyTotals().map(([m,v])=>{
                    const max=Math.max(...monthlyTotals().map(([,x])=>x));
                    const h=max>0?Math.round((v/max)*100):0;
                    return (
                      <div key={m} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                        <span style={{fontSize:10,color:"#666"}}>{fmt(v)}</span>
                        <div style={{width:"100%",height:`${h}px`,background:"#3266ad",borderRadius:4,minHeight:4}}></div>
                        <span style={{fontSize:10,color:"#666"}}>{m.slice(5)}</span>
                      </div>
                    );
                  })}
                </div>
            }
          </div>
          <div style={{background:"#fff",border:"1px solid #eee",borderRadius:12,padding:"1.25rem"}}>
            <h3 style={{margin:"0 0 .75rem",fontSize:15,fontWeight:500}}>Próximos vencimientos pendientes</h3>
            {expenses.filter(e=>!e.pagado&&e.dueDate&&new Date(e.dueDate)>=new Date()).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)).slice(0,5).length===0
              ? <p style={{fontSize:13,color:"#999"}}>Sin vencimientos pendientes.</p>
              : expenses.filter(e=>!e.pagado&&e.dueDate&&new Date(e.dueDate)>=new Date()).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)).slice(0,5).map(e=>(
                <div key={e.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 0",borderBottom:"1px solid #f0f0f0"}}>
                  <div>
                    <span style={{fontSize:13,fontWeight:500}}>{e.subcat}</span>
                    <span style={{fontSize:12,color:"#666",marginLeft:8}}>{e.desc}</span>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:10}}>
                    <span style={{fontSize:11,color:"#a32d2d"}}>{e.dueDate}</span>
                    <span style={{fontSize:13,fontWeight:500,color:"#e24b4a"}}>{fmt(e.amount)}</span>
                    <span onClick={()=>togglePagado(e.id)} style={badgeStyle(false)}>Marcar pagado</span>
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      )}

      {tab==="Gastos" && (
        <div>
          <div style={{display:"flex",gap:8,marginBottom:"1rem",flexWrap:"wrap"}}>
            <select value={filterCat} onChange={e=>setFilterCat(e.target.value)} style={{padding:"6px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:13}}>
              <option value="all">Todos los focos</option>
              {Object.entries(CATEGORIES).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
            </select>
            <select value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} style={{padding:"6px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:13}}>
              <option value="all">Todos los meses</option>
              {MONTHS_FULL.map((m,i)=><option key={i} value={i+1}>{m}</option>)}
            </select>
            <select value={filterPagado} onChange={e=>setFilterPagado(e.target.value)} style={{padding:"6px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:13}}>
              <option value="all">Todos los estados</option>
              <option value="pagado">Solo pagados</option>
              <option value="pendiente">Solo pendientes</option>
            </select>
          </div>
          {loadingData ? <p style={{textAlign:"center",color:"#999",fontSize:14}}>Cargando gastos...</p>
          : filtered.length===0
            ? <div style={{textAlign:"center",padding:"3rem",color:"#999",fontSize:14}}>No hay gastos que coincidan.</div>
            : <div style={{display:"flex",flexDirection:"column",gap:6}}>
                {filtered.sort((a,b)=>b.date?.localeCompare(a.date)).map(e=>{
                  const cat=CATEGORIES[e.category];
                  return (
                    <div key={e.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#fff",border:`1px solid ${e.pagado?"#1d9e7533":"#e24b4a33"}`,borderLeft:`3px solid ${e.pagado?"#1d9e75":"#e24b4a"}`,borderRadius:8,padding:"10px 14px",gap:8}}>
                      <div style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0}}>
                        <span style={{fontSize:16}}>{cat?.icon}</span>
                        <div style={{minWidth:0}}>
                          <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                            <span style={{fontSize:13,fontWeight:500}}>{e.subcat}</span>
                            <span style={{fontSize:11,padding:"2px 7px",borderRadius:20,background:cat?.color+"22",color:cat?.color}}>{cat?.label}</span>
                            <span style={{fontSize:11,padding:"2px 7px",borderRadius:20,background:"#f5f5f5",color:"#666"}}>{e.medio||"—"}</span>
                            {e.recurring&&<span style={{fontSize:11,padding:"2px 7px",borderRadius:20,background:"#3266ad22",color:"#185fa5"}}>Recurrente</span>}
                          </div>
                          <div style={{fontSize:11,color:"#999",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.desc||"—"} · {e.date}{e.dueDate?` · Vence: ${e.dueDate}`:""}</div>
                        </div>
                      </div>
                      <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                        <span style={{fontWeight:500,fontSize:14}}>{fmt(e.amount)}</span>
                        <span onClick={()=>togglePagado(e.id)} style={badgeStyle(e.pagado)}>{e.pagado?"✓ Pagado":"● Pendiente"}</span>
                        <button onClick={()=>edit(e)} style={{fontSize:12,padding:"3px 10px",background:"none",border:"1px solid #ddd",borderRadius:8,cursor:"pointer",color:"#666"}}>Editar</button>
                        <button onClick={()=>del(e.id)} style={{fontSize:12,padding:"3px 8px",background:"none",border:"1px solid #ddd",borderRadius:8,cursor:"pointer",color:"#e24b4a"}}>✕</button>
                      </div>
                    </div>
                  );
                })}
              </div>
          }
          {filtered.length>0&&<div style={{marginTop:12,textAlign:"right",fontWeight:500,fontSize:14}}>Total: {fmt(filtered.reduce((s,e)=>s+e.amount,0))}</div>}
        </div>
      )}

      {tab==="Calendario" && (
        <div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1rem"}}>
            <button onClick={()=>{let m=calMonth-1,y=calYear;if(m<0){m=11;y--;}setCalMonth(m);setCalYear(y);}} style={{padding:"6px 14px",background:"none",border:"1px solid #ddd",borderRadius:8,cursor:"pointer",fontSize:16}}>‹</button>
            <h3 style={{margin:0,fontSize:16,fontWeight:500}}>{MONTHS_FULL[calMonth]} {calYear}</h3>
            <button onClick={()=>{let m=calMonth+1,y=calYear;if(m>11){m=0;y++;}setCalMonth(m);setCalYear(y);}} style={{padding:"6px 14px",background:"none",border:"1px solid #ddd",borderRadius:8,cursor:"pointer",fontSize:16}}>›</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2,marginBottom:4}}>
            {["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"].map(d=><div key={d} style={{textAlign:"center",fontSize:11,color:"#999",padding:"4px 0",fontWeight:500}}>{d}</div>)}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",gap:2}}>
            {Array(firstDay).fill(null).map((_,i)=><div key={`e${i}`}></div>)}
            {Array(daysInMonth).fill(null).map((_,i)=>{
              const day=i+1;
              const key=`${calYear}-${String(calMonth+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
              const items=dueDates[key]||[];
              const today=new Date();
              const isToday=today.getFullYear()===calYear&&today.getMonth()===calMonth&&today.getDate()===day;
              return (
                <div key={day} style={{minHeight:72,padding:"4px 5px",border:"1px solid #eee",borderRadius:8,background:isToday?"#eff6ff":"#fff"}}>
                  <div style={{fontSize:12,fontWeight:isToday?500:400,color:isToday?"#3266ad":"#999",marginBottom:3}}>{day}</div>
                  {items.map((e,idx)=>(
                    <div key={idx} style={{fontSize:10,padding:"2px 4px",borderRadius:3,background:e.pagado?"#f0faf5":"#fef2f2",color:e.pagado?"#0f6e56":"#a32d2d",border:`1px solid ${e.pagado?"#1d9e7533":"#e24b4a33"}`,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.subcat}</div>
                  ))}
                </div>
              );
            })}
          </div>
          <div style={{display:"flex",gap:16,marginTop:12,fontSize:12,color:"#666"}}>
            <span>🟢 Pagado</span>
            <span>🔴 Pendiente</span>
          </div>
        </div>
      )}

      {tab==="Análisis" && (
        <div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
            <div style={{background:"#fff",border:"1px solid #eee",borderRadius:12,padding:"1.25rem"}}>
              <h3 style={{margin:"0 0 1rem",fontSize:15,fontWeight:500}}>Distribución por foco</h3>
              {totalAll===0 ? <p style={{fontSize:13,color:"#999"}}>Sin datos aún.</p>
                : Object.entries(CATEGORIES).map(([k,v])=>{
                    const tot=totalByCat(k);
                    const pct=totalAll>0?Math.round((tot/totalAll)*100):0;
                    return (
                      <div key={k} style={{marginBottom:14}}>
                        <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:4}}>
                          <span>{v.icon} {v.label}</span>
                          <span style={{fontWeight:500}}>{fmt(tot)} ({pct}%)</span>
                        </div>
                        <div style={{height:8,background:"#f0f0f0",borderRadius:4}}>
                          <div style={{height:"100%",width:`${pct}%`,background:v.color,borderRadius:4}}></div>
                        </div>
                      </div>
                    );
                  })
              }
            </div>
            <div style={{background:"#fff",border:"1px solid #eee",borderRadius:12,padding:"1.25rem"}}>
              <h3 style={{margin:"0 0 1rem",fontSize:15,fontWeight:500}}>Top categorías</h3>
              {subCatTotals().length===0 ? <p style={{fontSize:13,color:"#999"}}>Sin datos aún.</p>
                : subCatTotals().map(([key,amt],i)=>{
                    const [cat,sub]=key.split("__");
                    const color=CATEGORIES[cat]?.color||"#888";
                    return (
                      <div key={key} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                        <span style={{fontSize:12,color:"#999",minWidth:16,textAlign:"right"}}>{i+1}</span>
                        <div style={{flex:1}}>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:3}}>
                            <span style={{color:"#666",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"60%"}}>{sub}</span>
                            <span style={{fontWeight:500}}>{fmt(amt)}</span>
                          </div>
                          <div style={{height:6,background:"#f0f0f0",borderRadius:3}}>
                            <div style={{height:"100%",width:`${Math.round((amt/(subCatTotals()[0][1]||1))*100)}%`,background:color,borderRadius:3}}></div>
                          </div>
                        </div>
                      </div>
                    );
                  })
              }
            </div>
          </div>
          <div style={{background:"#fff",border:"1px solid #eee",borderRadius:12,padding:"1.25rem",marginTop:16}}>
            <h3 style={{margin:"0 0 1rem",fontSize:15,fontWeight:500}}>Resumen por mes y foco</h3>
            {expenses.length===0 ? <p style={{fontSize:13,color:"#999"}}>Sin datos aún.</p>
              : (() => {
                  const months=[...new Set(expenses.map(e=>e.date?.slice(0,7)).filter(Boolean))].sort().reverse().slice(0,6);
                  return (
                    <div style={{overflowX:"auto"}}>
                      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                        <thead>
                          <tr style={{borderBottom:"1px solid #eee"}}>
                            <th style={{textAlign:"left",padding:"6px 10px",fontWeight:500,color:"#666"}}>Categoría</th>
                            {months.map(m=><th key={m} style={{textAlign:"right",padding:"6px 10px",fontWeight:500,color:"#666"}}>{m.slice(5)}/{m.slice(2,4)}</th>)}
                          </tr>
                        </thead>
                        <tbody>
                          {Object.entries(CATEGORIES).map(([k,v])=>{
                            const rowTotal=months.reduce((s,m)=>s+expenses.filter(e=>e.category===k&&e.date?.startsWith(m)).reduce((a,b)=>a+b.amount,0),0);
                            if(rowTotal===0) return null;
                            return (
                              <tr key={k} style={{borderBottom:"1px solid #f5f5f5"}}>
                                <td style={{padding:"7px 10px",fontWeight:500}}>{v.icon} {v.label}</td>
                                {months.map(m=>{
                                  const tot=expenses.filter(e=>e.category===k&&e.date?.startsWith(m)).reduce((a,b)=>a+b.amount,0);
                                  return <td key={m} style={{textAlign:"right",padding:"7px 10px",color:tot>0?"#1a1a1a":"#ccc"}}>{tot>0?fmt(tot):"—"}</td>;
                                })}
                              </tr>
                            );
                          })}
                          <tr style={{borderTop:"1px solid #eee",fontWeight:500}}>
                            <td style={{padding:"7px 10px"}}>Total</td>
                            {months.map(m=>{
                              const tot=expenses.filter(e=>e.date?.startsWith(m)).reduce((a,b)=>a+b.amount,0);
                              return <td key={m} style={{textAlign:"right",padding:"7px 10px",color:"#3266ad"}}>{fmt(tot)}</td>;
                            })}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  );
                })()
            }
          </div>
        </div>
      )}
    </div>
  );
}
