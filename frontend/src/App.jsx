import { useState, useEffect, useRef } from "react";
import React from "react";
import { supabase } from "./supabase.js";
import { getBlueRate, getLatestBlueRate, getLatestBlueDate, mergeBlueData, parseBlueCSV } from "./dolarBlueData.js";

// ─── CONSTANTES ────────────────────────────────────────────────────────────────

const DEFAULT_CATEGORIES = {
  hogar: { label:"Hogar", icon:"🏠", color:"#3266ad", subcats:["Luz","Gas","Agua","Internet","TV Streaming","Impuesto Municipal","Impuesto Provincial","Seguro Hogar","Vigilancia","Monitoreo de Puerta","Otros"] },
  autos: { label:"Autos", icon:"🚗", color:"#d85a30", subcats:["VW Polo - Seguro","VW Polo - Combustible","VW Polo - Mecánico","VW Polo - Service","VW Gol - Seguro","VW Gol - Combustible","VW Gol - Mecánico","VW Gol - Service"] },
  hijos: { label:"Hijos", icon:"🧑‍🧑‍🧒‍🧒", color:"#1d9e75", subcats:["Colegio","Actividades","Otros"] }
};

const DEFAULT_INCOME_CATEGORIES = ["Sueldo","Freelance / Honorarios","Alquiler cobrado","Dividendos","Venta de activos","Bono","Otros ingresos"];
const BASE_MEDIOS = ["Débito automático","Transferencia","Efectivo","VISA ICBC","VISA Santander","Amex Santander"];
const MEDIOS_TARJETA = ["VISA ICBC","VISA Santander","Amex Santander"]; // medios que NO impactan Ahorros hasta el pago
const MONTHS_FULL = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const TABS = ["Dashboard","Gastos","Ingresos","Calendario","Análisis","Ahorros"];
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";

// ─── HELPERS ────────────────────────────────────────────────────────────────────

function fmtUSD(n) { return new Intl.NumberFormat("es-AR",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(n||0); }
function fmtARS(n) { return new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0}).format(n||0); }
function fmtK(v) { if(Math.abs(v)>=1000000) return 'U$S '+(v/1000000).toFixed(1)+'M'; if(Math.abs(v)>=1000) return 'U$S '+(v/1000).toFixed(1)+'k'; return 'U$S '+v.toFixed(0); }
function fmtRaw(n) { return Math.round(n||0).toLocaleString('es-AR'); }

/** Convierte un monto a USD usando el blue del día de la transacción (o el más reciente). */
function toUSD(amount, moneda, date) {
  if (!amount) return 0;
  if (moneda === "USD") return amount;
  const rate = date ? (getBlueRate(date) || getLatestBlueRate()) : getLatestBlueRate();
  return rate ? amount / rate : 0;
}

/** Muestra monto original + equivalente USD (si es ARS) */
function MontoDisplay({ amount, moneda, date, size = 14 }) {
  const usd = toUSD(amount, moneda, date);
  return (
    <div style={{textAlign:"right"}}>
      <div style={{fontWeight:600,fontSize:size,color:moneda==="USD"?"#3266ad":"#1a1a1a"}}>
        {moneda === "USD" ? fmtUSD(amount) : fmtARS(amount)}
      </div>
      {moneda === "ARS" && (
        <div style={{fontSize:11,color:"#aaa"}}>{fmtUSD(usd)}</div>
      )}
    </div>
  );
}

const badgeStyle = (pagado) => ({
  display:"inline-flex", alignItems:"center", gap:4, fontSize:11,
  padding:"3px 10px", borderRadius:20, cursor:"pointer", fontWeight:500, userSelect:"none",
  background: pagado ? "#1d9e7522" : "#e24b4a22",
  color: pagado ? "#0f6e56" : "#a32d2d",
  border: `0.5px solid ${pagado?"#1d9e75":"#e24b4a"}44`,
  whiteSpace:"nowrap"
});

function exportCSV(rows, filename) {
  const csv = rows.map(r=>r.map(c=>`"${c||""}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8;"});
  const a = document.createElement("a"); a.href=URL.createObjectURL(blob); a.download=filename+".csv"; a.click();
}

async function exportPDF(title, filename, elementId) {
  const { jsPDF } = await import("jspdf");
  const html2canvas = (await import("html2canvas")).default;
  const el = elementId ? document.getElementById(elementId) : document.body;
  if (!el) return;
  const canvas = await html2canvas(el, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
  const imgData = canvas.toDataURL("image/png");
  const imgW = canvas.width / 2; const imgH = canvas.height / 2;
  const pdf = new jsPDF({ orientation: imgW > imgH ? "landscape" : "portrait", unit: "px", format: [imgW + 40, imgH + 60] });
  pdf.setFontSize(13); pdf.setFont("helvetica","bold"); pdf.text(title, 20, 22);
  pdf.setFontSize(9); pdf.setFont("helvetica","normal"); pdf.text(new Date().toLocaleDateString("es-AR"), 20, 36);
  pdf.addImage(imgData, "PNG", 20, 44, imgW, imgH);
  pdf.save(filename+".pdf");
}

function ExportButtons({ onCSV, onPDF }) {
  return (
    <div style={{display:"flex",gap:6}}>
      <button onClick={onCSV} style={{fontSize:12,padding:"4px 12px",background:"#f5f5f5",border:"1px solid #ddd",borderRadius:8,cursor:"pointer",color:"#1a1a1a"}}>↓ Excel</button>
      <button onClick={onPDF} style={{fontSize:12,padding:"4px 12px",background:"#f5f5f5",border:"1px solid #ddd",borderRadius:8,cursor:"pointer",color:"#1a1a1a"}}>↓ PDF</button>
    </div>
  );
}

// ─── WIDGET TIPO DE CAMBIO (solo informativo) ────────────────────────────────────

function TipoCambioWidget() {
  const latestRate = getLatestBlueRate();
  const latestDate = getLatestBlueDate();
  return (
    <div style={{display:"inline-flex",alignItems:"center",gap:8,padding:"6px 14px",background:"#f0f4ff",borderRadius:8,fontSize:13,border:"1px solid #3266ad22"}}>
      <span>💵</span>
      <span style={{color:"#666"}}>Blue:</span>
      <span style={{fontWeight:700,color:"#3266ad",fontSize:14}}>{latestRate ? fmtARS(latestRate) : "—"}</span>
      <span style={{fontSize:11,color:"#999"}}>({latestDate})</span>
    </div>
  );
}

// ─── MEDIOS DE PAGO ──────────────────────────────────────────────────────────────

function MedioSelector({ value, onChange, medios, onAddMedio }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newMedio, setNewMedio] = useState("");
  const handleAdd = () => { const v=newMedio.trim(); if(!v) return; onAddMedio(v); onChange(v); setNewMedio(""); setShowAdd(false); };
  return (
    <div>
      <select value={showAdd?"__add__":value} onChange={e=>{ if(e.target.value==="__add__"){setShowAdd(true);return;} onChange(e.target.value); }} style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}>
        {medios.map(m=><option key={m}>{m}</option>)}
        <option value="__add__">+ Agregar nuevo...</option>
      </select>
      {showAdd&&(
        <div style={{display:"flex",gap:6,marginTop:6}}>
          <input autoFocus value={newMedio} onChange={e=>setNewMedio(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAdd()} placeholder="Nombre del medio..." style={{flex:1,padding:"6px 10px",borderRadius:8,border:"1px solid #3266ad",fontSize:13,boxSizing:"border-box"}}/>
          <button onClick={handleAdd} style={{padding:"6px 12px",background:"#3266ad",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:13}}>✓</button>
          <button onClick={()=>{setShowAdd(false);setNewMedio("");}} style={{padding:"6px 10px",background:"none",border:"1px solid #ddd",borderRadius:8,cursor:"pointer",fontSize:13,color:"#999"}}>✕</button>
        </div>
      )}
    </div>
  );
}

// ─── SELECTOR DE MONEDA ──────────────────────────────────────────────────────────

function MonedaSelector({ value, onChange, date }) {
  const rate = getBlueRate(date) || getLatestBlueRate();
  return (
    <div>
      <div style={{display:"flex",gap:6}}>
        {["ARS","USD"].map(m=>(
          <button key={m} onClick={()=>onChange(m)} style={{flex:1,padding:"7px",borderRadius:8,border:`1px solid ${value===m?"#3266ad":"#ddd"}`,background:value===m?"#f0f4ff":"#fff",color:value===m?"#3266ad":"#666",fontWeight:value===m?600:400,cursor:"pointer",fontSize:14}}>
            {m}
          </button>
        ))}
      </div>
      {rate&&<p style={{fontSize:11,color:"#999",margin:"4px 0 0"}}>Blue {date||"hoy"}: {fmtARS(rate)}</p>}
    </div>
  );
}

// ─── EXPANDABLE TABLE ────────────────────────────────────────────────────────────

function ExpandableTable({ expenses, categories }) {
  const [expanded, setExpanded] = useState({});
  if (!expenses.length) return <p style={{fontSize:13,color:"#999"}}>Sin datos.</p>;
  const months = [...new Set(expenses.map(e=>e.date?.slice(0,7)).filter(Boolean))].sort().reverse().slice(0,6);
  const toggle = k => setExpanded(p=>({...p,[k]:!p[k]}));
  const sumCat = (cat,m) => expenses.filter(e=>e.category===cat&&e.date?.startsWith(m)).reduce((s,e)=>s+toUSD(e.amount,e.moneda,e.date),0);
  const sumSub = (sub,m) => expenses.filter(e=>e.subcat===sub&&e.date?.startsWith(m)).reduce((s,e)=>s+toUSD(e.amount,e.moneda,e.date),0);
  const grandTotal = m => expenses.filter(e=>e.date?.startsWith(m)).reduce((s,e)=>s+toUSD(e.amount,e.moneda,e.date),0);
  return (
    <div style={{overflowX:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead>
          <tr style={{borderBottom:"1px solid #eee"}}>
            <th style={{textAlign:"left",padding:"6px 10px",fontWeight:500,color:"#666",minWidth:140}}>Foco / Concepto</th>
            {months.map(m=><th key={m} style={{textAlign:"right",padding:"6px 10px",fontWeight:500,color:"#666",whiteSpace:"nowrap"}}>{m.slice(5)}/{m.slice(2,4)}</th>)}
          </tr>
        </thead>
        <tbody>
          {Object.entries(categories).map(([k,v])=>{
            const subcats=[...new Set(expenses.filter(e=>e.category===k).map(e=>e.subcat))].sort();
            const rowTotal=months.reduce((s,m)=>s+sumCat(k,m),0);
            if(!rowTotal) return null;
            return (
              <React.Fragment key={k}>
                <tr onClick={()=>toggle(k)} style={{cursor:"pointer",borderBottom:"1px solid #f0f0f0",background:expanded[k]?"#f9f9f9":"#fff"}}>
                  <td style={{padding:"8px 10px",fontWeight:500}}>
                    <span style={{fontSize:15,marginRight:6}}>{v.icon}</span>
                    <span style={{color:v.color}}>{v.label}</span>
                    <span style={{marginLeft:6,fontSize:11,color:"#999"}}>{expanded[k]?"▲":"▼"}</span>
                  </td>
                  {months.map(m=>{ const tot=sumCat(k,m); return <td key={m} style={{textAlign:"right",padding:"8px 10px",fontWeight:500,color:tot>0?"#1a1a1a":"#ccc"}}>{tot>0?fmtUSD(tot):"—"}</td>; })}
                </tr>
                {expanded[k]&&subcats.map(sub=>{ const hasData=months.some(m=>sumSub(sub,m)>0); if(!hasData) return null; return(
                  <tr key={sub} style={{borderBottom:"1px solid #f5f5f5",background:"#fafafa"}}>
                    <td style={{padding:"5px 10px 5px 32px",color:"#666",borderLeft:`2px solid ${v.color}44`,fontSize:12}}>{sub}</td>
                    {months.map(m=>{ const tot=sumSub(sub,m); return <td key={m} style={{textAlign:"right",padding:"5px 10px",fontSize:12,color:tot>0?"#1a1a1a":"#ddd"}}>{tot>0?fmtUSD(tot):"—"}</td>; })}
                  </tr>
                );})}
                {expanded[k]&&<tr><td colSpan={months.length+1} style={{padding:0,borderBottom:"1px solid #eee"}}></td></tr>}
              </React.Fragment>
            );
          })}
          <tr style={{borderTop:"1px solid #eee",fontWeight:600}}>
            <td style={{padding:"8px 10px"}}>Total</td>
            {months.map(m=><td key={m} style={{textAlign:"right",padding:"8px 10px",color:"#3266ad"}}>{fmtUSD(grandTotal(m))}</td>)}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ─── EDITOR DE CATEGORÍAS ────────────────────────────────────────────────────────

function CategoryEditor({ categories, onClose, onSave }) {
  const [cats,setCats]=useState(JSON.parse(JSON.stringify(categories)));
  const [newFocoLabel,setNewFocoLabel]=useState(""); const [newFocoIcon,setNewFocoIcon]=useState("📦"); const [newFocoColor,setNewFocoColor]=useState("#3266ad");
  const [newSubcats,setNewSubcats]=useState({}); const [saving,setSaving]=useState(false);
  const addFoco=()=>{ if(!newFocoLabel.trim()) return; const key=newFocoLabel.toLowerCase().replace(/\s+/g,"-").replace(/[^a-z0-9-]/g,""); if(cats[key]) return; setCats(p=>({...p,[key]:{label:newFocoLabel,icon:newFocoIcon,color:newFocoColor,subcats:[]}})); setNewFocoLabel(""); setNewFocoIcon("📦"); setNewFocoColor("#3266ad"); };
  const addSubcat=(foco)=>{ const val=(newSubcats[foco]||"").trim(); if(!val) return; setCats(p=>({...p,[foco]:{...p[foco],subcats:[...p[foco].subcats,val]}})); setNewSubcats(p=>({...p,[foco]:""})); };
  const removeSubcat=(foco,sub)=>setCats(p=>({...p,[foco]:{...p[foco],subcats:p[foco].subcats.filter(s=>s!==sub)}}));
  const handleSave=async()=>{ setSaving(true); await supabase.from("categorias").delete().neq("id",0); const rows=[]; Object.entries(cats).forEach(([foco,v])=>{ v.subcats.forEach(sub=>rows.push({foco,foco_label:v.label,foco_icon:v.icon,foco_color:v.color,subcat:sub})); }); if(rows.length) await supabase.from("categorias").insert(rows); onSave(cats); setSaving(false); onClose(); };
  return(
    <div style={{position:"fixed",top:0,left:0,right:0,bottom:0,background:"rgba(0,0,0,0.4)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:"1rem"}}>
      <div style={{background:"#fff",borderRadius:16,padding:"1.5rem",width:"100%",maxWidth:600,maxHeight:"85vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.25rem"}}>
          <h3 style={{margin:0,fontSize:17,fontWeight:500}}>Editar focos y categorías</h3>
          <button onClick={onClose} style={{background:"none",border:"none",fontSize:20,cursor:"pointer",color:"#999"}}>✕</button>
        </div>
        {Object.entries(cats).map(([foco,v])=>(
          <div key={foco} style={{marginBottom:"1.25rem",background:"#f9f9f9",borderRadius:10,padding:"1rem"}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:10}}><span style={{fontSize:20}}>{v.icon}</span><span style={{fontWeight:500,fontSize:15,color:v.color}}>{v.label}</span></div>
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
              {v.subcats.map(sub=>(<span key={sub} style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:12,padding:"3px 10px",borderRadius:20,background:v.color+"22",color:v.color}}>{sub}<span onClick={()=>removeSubcat(foco,sub)} style={{cursor:"pointer",fontWeight:700,fontSize:14,lineHeight:1}}>×</span></span>))}
            </div>
            <div style={{display:"flex",gap:6}}>
              <input value={newSubcats[foco]||""} onChange={e=>setNewSubcats(p=>({...p,[foco]:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&addSubcat(foco)} placeholder="Nueva categoría..." style={{flex:1,padding:"6px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:13}}/>
              <button onClick={()=>addSubcat(foco)} style={{padding:"6px 14px",background:v.color,color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:13}}>+ Agregar</button>
            </div>
          </div>
        ))}
        <div style={{background:"#f0f4ff",borderRadius:10,padding:"1rem",marginBottom:"1rem"}}>
          <p style={{fontSize:13,fontWeight:500,margin:"0 0 10px",color:"#3266ad"}}>+ Nuevo foco</p>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
            <div><label style={{fontSize:11,color:"#666",display:"block",marginBottom:3}}>Nombre</label><input value={newFocoLabel} onChange={e=>setNewFocoLabel(e.target.value)} placeholder="Ej: Mascotas" style={{width:"100%",padding:"6px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:13,boxSizing:"border-box"}}/></div>
            <div><label style={{fontSize:11,color:"#666",display:"block",marginBottom:3}}>Ícono</label><input value={newFocoIcon} onChange={e=>setNewFocoIcon(e.target.value)} placeholder="🐶" style={{width:"100%",padding:"6px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:13,boxSizing:"border-box"}}/></div>
            <div><label style={{fontSize:11,color:"#666",display:"block",marginBottom:3}}>Color</label><input type="color" value={newFocoColor} onChange={e=>setNewFocoColor(e.target.value)} style={{width:"100%",height:34,padding:"2px",borderRadius:8,border:"1px solid #ddd",cursor:"pointer"}}/></div>
          </div>
          <button onClick={addFoco} style={{padding:"7px 16px",background:"#3266ad",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:13,fontWeight:500}}>Crear foco</button>
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <button onClick={onClose} style={{padding:"8px 16px",background:"none",border:"1px solid #ddd",borderRadius:8,cursor:"pointer",fontSize:14,color:"#666"}}>Cancelar</button>
          <button onClick={handleSave} disabled={saving} style={{padding:"8px 20px",background:"#3266ad",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:14,fontWeight:500}}>{saving?"Guardando...":"Guardar cambios"}</button>
        </div>
      </div>
    </div>
  );
}

// ─── SELECTOR DE CUENTA ORIGEN (para gastos no-tarjeta) ─────────────────────────

function CuentaOrigenSelector({ value, onChange, moneda, date, tcManual, onTcChange, amount }) {
  const [cuentas, setCuentas] = useState([]);
  useEffect(() => {
    supabase.from("cuentas").select("id,nombre,tipo,saldo_inicial").order("orden")
      .then(({ data }) => { if (data) setCuentas(data); });
  }, []);

  const tc = parseFloat(tcManual) || getBlueRate(date) || getLatestBlueRate() || 1;
  const monto_usd = amount && moneda === "ARS" ? parseFloat(amount) / tc : parseFloat(amount) || 0;

  return (
    <>
      <div style={{gridColumn:"1/-1",background:"#f0faf5",border:"1px solid #1d9e7533",borderRadius:10,padding:"12px 14px"}}>
        <p style={{fontSize:12,fontWeight:500,color:"#0f6e56",margin:"0 0 10px"}}>💸 Este gasto descuenta de una cuenta — ¿de cuál sale?</p>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <div><label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Cuenta origen (opcional)</label>
            <select value={value} onChange={e=>onChange(e.target.value)} style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}>
              <option value="">— No descontar de ninguna cuenta —</option>
              {cuentas.map(c=><option key={c.id} value={c.id}>{c.tipo==="tarjeta"?"💳":"🏦"} {c.nombre}</option>)}
            </select>
          </div>
          {moneda==="ARS"&&value&&(
            <div><label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>TC utilizado (editable)</label>
              <input type="number" value={tcManual} onChange={e=>onTcChange(e.target.value)} placeholder={String(getBlueRate(date)||getLatestBlueRate()||"")} style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #3266ad",fontSize:14,background:"#f0f4ff",boxSizing:"border-box"}}/>
              {amount&&<p style={{fontSize:11,color:"#999",margin:"3px 0 0"}}>≈ {fmtUSD(monto_usd)} que se descontarán de la cuenta</p>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

// ─── SELECTOR DE CUENTA DESTINO (para ingresos) ──────────────────────────────────

function CuentaDestinoSelector({ value, onChange, moneda, date, tcManual, onTcChange, amount }) {
  const [cuentas, setCuentas] = useState([]);
  useEffect(() => {
    supabase.from("cuentas").select("id,nombre,tipo").order("orden")
      .then(({ data }) => { if (data) setCuentas(data); });
  }, []);

  const tc = parseFloat(tcManual) || getBlueRate(date) || getLatestBlueRate() || 1;
  const monto_usd = amount && moneda === "ARS" ? parseFloat(amount) / tc : parseFloat(amount) || 0;

  return (
    <div style={{gridColumn:"1/-1",background:"#f0f4ff",border:"1px solid #3266ad33",borderRadius:10,padding:"12px 14px"}}>
      <p style={{fontSize:12,fontWeight:500,color:"#3266ad",margin:"0 0 10px"}}>💰 ¿Este ingreso acredita en alguna cuenta?</p>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
        <div><label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Cuenta destino (opcional)</label>
          <select value={value} onChange={e=>onChange(e.target.value)} style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}>
            <option value="">— No acreditar en ninguna cuenta —</option>
            {cuentas.map(c=><option key={c.id} value={c.id}>{c.tipo==="tarjeta"?"💳":"🏦"} {c.nombre}</option>)}
          </select>
        </div>
        {moneda==="ARS"&&value&&(
          <div><label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>TC utilizado (editable)</label>
            <input type="number" value={tcManual} onChange={e=>onTcChange(e.target.value)} placeholder={String(getBlueRate(date)||getLatestBlueRate()||"")} style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #3266ad",fontSize:14,background:"#f0f4ff",boxSizing:"border-box"}}/>
            {amount&&<p style={{fontSize:11,color:"#999",margin:"3px 0 0"}}>≈ {fmtUSD(monto_usd)} que se acreditarán en la cuenta</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── PANEL TIPO DE CAMBIO (carga CSV + muestra histórico) ───────────────────────

function TipoCambioPanel({ onUpdate }) {
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState("");
  const [showHistorico, setShowHistorico] = useState(false);
  const csvRef = useRef();

  // Últimos 10 valores del histórico en memoria
  const latestEntries = Object.entries(
    // BLUE_HISTORY no es accesible acá directamente, usamos getBlueRate para los últimos 10 días
    (() => {
      const today = new Date();
      const entries = [];
      for (let i = 0; i < 30; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const iso = d.toISOString().slice(0, 10);
        const val = getBlueRate(iso);
        if (val && (entries.length === 0 || entries[entries.length - 1][1] !== val || entries.length < 2)) {
          entries.push([iso, val]);
        }
        if (entries.length >= 10) break;
      }
      return Object.fromEntries(entries);
    })()
  ).sort(([a], [b]) => b.localeCompare(a));

  const handleCSV = async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    setUploading(true);
    setMsg("Procesando CSV...");
    try {
      const text = await f.text();
      const rows = parseBlueCSV(text);
      if (!rows.length) { setMsg("❌ No se encontraron datos válidos en el CSV."); setUploading(false); return; }

      // Merge en memoria
      mergeBlueData(rows);

      // Guardar en Supabase (upsert por fecha)
      const { error } = await supabase
        .from("blue_historico")
        .upsert(rows.map(r => ({ fecha: r.fecha, valor: r.valor })), { onConflict: "fecha" });

      if (error) setMsg(`⚠️ Datos cargados en memoria, pero error al guardar: ${error.message}`);
      else setMsg(`✓ ${rows.length} cotizaciones cargadas. Último dato: ${rows.sort((a,b)=>b.fecha.localeCompare(a.fecha))[0].fecha}`);

      onUpdate?.(); // re-render del padre
    } catch (err) {
      setMsg("❌ Error procesando el archivo.");
    }
    setUploading(false);
    e.target.value = "";
  };

  const latestRate = getLatestBlueRate();
  const latestDate = getLatestBlueDate();

  return (
    <div style={{ background: "#fff", border: "1px solid #eee", borderRadius: 12, padding: "1.25rem", marginBottom: "1.25rem" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 22 }}>💵</span>
          <div>
            <div style={{ fontSize: 13, color: "#666", marginBottom: 2 }}>Dólar Blue (último dato)</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: "#3266ad", lineHeight: 1 }}>{latestRate ? fmtARS(latestRate) : "—"}</div>
            <div style={{ fontSize: 11, color: "#999", marginTop: 2 }}>{latestDate || "—"}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <button
            onClick={() => setShowHistorico(p => !p)}
            style={{ fontSize: 12, padding: "5px 12px", background: "#f5f5f5", border: "1px solid #ddd", borderRadius: 8, cursor: "pointer", color: "#666" }}
          >
            {showHistorico ? "Ocultar histórico" : "Ver últimos valores"}
          </button>
          <input ref={csvRef} type="file" accept=".csv" onChange={handleCSV} style={{ display: "none" }} />
          <button
            onClick={() => csvRef.current.click()}
            disabled={uploading}
            style={{ fontSize: 13, padding: "6px 14px", background: "#3266ad", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontWeight: 500 }}
          >
            {uploading ? "Cargando..." : "↑ Actualizar CSV Blue"}
          </button>
        </div>
      </div>

      {msg && (
        <div style={{ marginTop: 10, fontSize: 12, padding: "6px 12px", borderRadius: 8, background: msg.startsWith("✓") ? "#f0faf5" : "#fef2f2", color: msg.startsWith("✓") ? "#0f6e56" : "#a32d2d", border: `1px solid ${msg.startsWith("✓") ? "#1d9e7533" : "#e24b4a33"}` }}>
          {msg}
        </div>
      )}

      {showHistorico && (
        <div style={{ marginTop: 12, borderTop: "1px solid #f0f0f0", paddingTop: 12 }}>
          <p style={{ fontSize: 12, color: "#999", margin: "0 0 8px" }}>Últimos valores cargados en memoria:</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {latestEntries.map(([fecha, valor]) => (
              <div key={fecha} style={{ fontSize: 12, padding: "4px 10px", borderRadius: 20, background: "#f0f4ff", color: "#3266ad", border: "1px solid #3266ad22" }}>
                <span style={{ color: "#999", marginRight: 4 }}>{fecha}</span>
                <strong>{fmtARS(valor)}</strong>
              </div>
            ))}
          </div>
          <p style={{ fontSize: 11, color: "#bbb", margin: "8px 0 0" }}>
            Los días sin cotización (fines de semana, feriados) usan el último valor disponible anterior.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── DASHBOARD ───────────────────────────────────────────────────────────────────

function Dashboard({ expenses, incomes, categories }) {
  const [dashTab, setDashTab] = useState("resumen");
  const [selectedMonth, setSelectedMonth] = useState(String(new Date().getMonth()+1));
  const [selectedYear] = useState(new Date().getFullYear());
  const [selectedConcepto, setSelectedConcepto] = useState("");
  const [blueVersion, setBlueVersion] = useState(0); // fuerza re-render al actualizar blue
  const chart1Ref=useRef(null); const chart2Ref=useRef(null); const chart3Ref=useRef(null);
  const c1=useRef(null); const c2=useRef(null); const c3=useRef(null);
  const isYearView = selectedMonth==="all";

  const allSubcats=[...new Set(expenses.map(e=>e.subcat))].sort();
  useEffect(()=>{ if(allSubcats.length&&!selectedConcepto) setSelectedConcepto(allSubcats[0]); },[expenses]);

  const monthStr=`${selectedYear}-${String(selectedMonth).padStart(2,"0")}`;
  const monthExp = isYearView ? expenses.filter(e=>e.date?.startsWith(String(selectedYear))) : expenses.filter(e=>e.date?.startsWith(monthStr));
  const monthInc = isYearView ? incomes.filter(i=>i.date?.startsWith(String(selectedYear))) : incomes.filter(i=>i.date?.startsWith(monthStr));

  const totalGastosUSD = monthExp.reduce((s,e)=>s+toUSD(e.amount,e.moneda,e.date),0);
  const totalIngresosUSD = monthInc.reduce((s,i)=>s+toUSD(i.amount,i.moneda,i.date),0);
  const balanceUSD = totalIngresosUSD - totalGastosUSD;
  const pagadoUSD = monthExp.filter(e=>e.pagado).reduce((s,e)=>s+toUSD(e.amount,e.moneda,e.date),0);
  const pendienteUSD = totalGastosUSD - pagadoUSD;

  const months=[...new Set([...expenses,...incomes].map(e=>e.date?.slice(0,7)).filter(Boolean))].sort();
  const conceptoData = selectedConcepto ? months.map(m=>expenses.filter(e=>e.subcat===selectedConcepto&&e.date?.startsWith(m)).reduce((s,e)=>s+toUSD(e.amount,e.moneda,e.date),0)) : [];
  const nonZero = conceptoData.filter(v=>v>0);
  const avg = nonZero.length ? nonZero.reduce((a,b)=>a+b,0)/nonZero.length : 0;
  const maxVal = conceptoData.length ? Math.max(...conceptoData) : 0;
  const minVal = nonZero.length ? Math.min(...nonZero) : 0;

  useEffect(()=>{
    if(dashTab!=="resumen"||!chart1Ref.current) return;
    if(c1.current) c1.current.destroy();
    const catData=Object.keys(categories).map(k=>monthExp.filter(e=>e.category===k).reduce((s,e)=>s+toUSD(e.amount,e.moneda,e.date),0));
    c1.current=new window.Chart(chart1Ref.current,{type:"bar",data:{labels:Object.values(categories).map(v=>v.label),datasets:[{data:catData,backgroundColor:Object.values(categories).map(v=>v.color),borderRadius:4,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmtUSD(c.raw)}}},scales:{x:{ticks:{autoSkip:false}},y:{ticks:{callback:v=>fmtK(v)}}}}});
    return()=>{ if(c1.current) c1.current.destroy(); };
  },[dashTab,selectedMonth,expenses]);

  useEffect(()=>{
    if(dashTab!=="comparador"||!chart2Ref.current||!selectedConcepto) return;
    if(c2.current) c2.current.destroy();
    c2.current=new window.Chart(chart2Ref.current,{type:"bar",data:{labels:months.map(m=>m.slice(5)),datasets:[{data:conceptoData,backgroundColor:conceptoData.map(v=>v===maxVal&&v>0?"#3266ad":"#85b7eb"),borderRadius:4,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmtUSD(c.raw)}}},scales:{x:{ticks:{autoSkip:false}},y:{ticks:{callback:v=>fmtK(v)}}}}});
    if(c3.current) c3.current.destroy();
    const varData=months.slice(1).map((_,i)=>{ const p=conceptoData[i],cv=conceptoData[i+1]; return(!p||!cv)?0:Math.round(((cv-p)/p)*100); });
    c3.current=new window.Chart(chart3Ref.current,{type:"bar",data:{labels:months.slice(1).map(m=>m.slice(5)),datasets:[{data:varData,backgroundColor:varData.map(v=>v>0?"#e24b4a":"#1d9e75"),borderRadius:4,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>(c.raw>0?"+":"")+c.raw+"%"}}},scales:{x:{ticks:{autoSkip:false}},y:{ticks:{callback:v=>v+"%"}}}}});
    return()=>{ if(c2.current) c2.current.destroy(); if(c3.current) c3.current.destroy(); };
  },[dashTab,selectedConcepto,expenses]);

  useEffect(()=>{
    if(dashTab!=="evolucion"||!chart1Ref.current) return;
    if(c1.current) c1.current.destroy();
    const gastosByMonth=months.map(m=>expenses.filter(e=>e.date?.startsWith(m)).reduce((s,e)=>s+toUSD(e.amount,e.moneda,e.date),0));
    const ingresosByMonth=months.map(m=>incomes.filter(i=>i.date?.startsWith(m)).reduce((s,i)=>s+toUSD(i.amount,i.moneda,i.date),0));
    c1.current=new window.Chart(chart1Ref.current,{type:"bar",data:{labels:months.map(m=>m.slice(5)),datasets:[
      {label:"Ingresos",data:ingresosByMonth,backgroundColor:"#1d9e7555",borderColor:"#1d9e75",borderWidth:1,borderRadius:3},
      ...Object.entries(categories).map(([k,v])=>({label:v.label,data:months.map(m=>expenses.filter(e=>e.category===k&&e.date?.startsWith(m)).reduce((s,e)=>s+toUSD(e.amount,e.moneda,e.date),0)),backgroundColor:v.color,stack:"gastos",borderRadius:2}))
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true,position:"bottom",labels:{boxWidth:12,font:{size:11}}}},scales:{x:{stacked:true,ticks:{autoSkip:false}},y:{stacked:false,ticks:{callback:v=>fmtK(v)}}}}});
    return()=>{ if(c1.current) c1.current.destroy(); };
  },[dashTab,expenses,incomes]);

  const tabStyle=t=>({padding:"8px 16px",fontSize:13,background:"none",border:"none",borderBottom:dashTab===t?"2px solid #3266ad":"2px solid transparent",color:dashTab===t?"#3266ad":"#666",cursor:"pointer",fontWeight:dashTab===t?500:400});

  return (
    <div>
      <TipoCambioPanel onUpdate={() => setBlueVersion(v => v + 1)} />

      <div style={{padding:"8px 14px",background:"#f0f4ff",borderRadius:8,fontSize:12,color:"#666",marginBottom:"1rem",lineHeight:1.5}}>
        💵 <strong style={{color:"#3266ad"}}>Blue histórico:</strong> Cada transacción se convierte a USD usando la cotización del blue del día en que fue registrada (fuente: dolarhoy.com / histórico local). Último dato: <strong>{getLatestBlueDate()}</strong> — {fmtARS(getLatestBlueRate()??0)}.
      </div>

      <div style={{display:"flex",gap:0,marginBottom:"1.25rem",borderBottom:"1px solid #eee"}}>
        <button style={tabStyle("resumen")} onClick={()=>setDashTab("resumen")}>Resumen mensual</button>
        <button style={tabStyle("comparador")} onClick={()=>setDashTab("comparador")}>Comparar concepto</button>
        <button style={tabStyle("evolucion")} onClick={()=>setDashTab("evolucion")}>Evolución anual</button>
      </div>

      {dashTab==="resumen"&&(
        <div id="section-dashboard">
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1rem",flexWrap:"wrap",gap:8}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:14,fontWeight:500}}>{isYearView?"Período":"Mes"}:</span>
              <select value={selectedMonth} onChange={e=>setSelectedMonth(e.target.value)} style={{padding:"6px 12px",borderRadius:8,border:"1px solid #ddd",fontSize:13}}>
                <option value="all">Año {selectedYear}</option>
                {MONTHS_FULL.map((m,i)=><option key={i} value={String(i+1)}>{m} {selectedYear}</option>)}
              </select>
            </div>
            <ExportButtons onCSV={()=>{ const rows=[["Foco","Cat","Monto","Moneda","Blue del día","USD"]]; monthExp.forEach(e=>{const r=getBlueRate(e.date)||getLatestBlueRate(); rows.push([categories[e.category]?.label,e.subcat,fmtRaw(e.amount),e.moneda||"ARS",r||"",toUSD(e.amount,e.moneda,e.date).toFixed(2)]);}); exportCSV(rows,"dashboard"); }} onPDF={()=>exportPDF("Dashboard","dashboard","section-dashboard")}/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:"1rem"}}>
            {[[isYearView?"Gastos año":"Gastos mes",totalGastosUSD,"#e24b4a"],[isYearView?"Ingresos año":"Ingresos mes",totalIngresosUSD,"#1d9e75"],[isYearView?"Balance año":"Balance mes",balanceUSD,balanceUSD>=0?"#3266ad":"#e24b4a"]].map(([l,v,c])=>(
              <div key={l} style={{background:"#f9f9f9",borderRadius:8,padding:"1rem",textAlign:"center",border:`1px solid ${c}22`}}>
                <p style={{fontSize:11,color:"#666",margin:"0 0 4px"}}>{l}</p>
                <p style={{fontSize:20,fontWeight:700,margin:0,color:c}}>{fmtUSD(v)}</p>
              </div>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:"1rem"}}>
            {[["Pagado",pagadoUSD,"#1d9e75"],["Pendiente",pendienteUSD,"#e24b4a"]].map(([l,v,c])=>(
              <div key={l} style={{background:"#f9f9f9",borderRadius:8,padding:"0.85rem",textAlign:"center"}}>
                <p style={{fontSize:11,color:"#666",margin:"0 0 4px"}}>{l}</p>
                <p style={{fontSize:15,fontWeight:600,margin:0,color:c}}>{fmtUSD(v)}</p>
              </div>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:`repeat(${Object.keys(categories).length},1fr)`,gap:10,marginBottom:"1rem"}}>
            {Object.entries(categories).map(([k,v])=>{
              const exps=monthExp.filter(e=>e.category===k);
              const total=exps.reduce((s,e)=>s+toUSD(e.amount,e.moneda,e.date),0);
              const bySub={}; exps.forEach(e=>{bySub[e.subcat]=(bySub[e.subcat]||0)+toUSD(e.amount,e.moneda,e.date);});
              const top=Object.entries(bySub).sort(([,a],[,b])=>b-a);
              return(
                <div key={k} style={{background:"#fff",border:"1px solid #eee",borderRadius:12,padding:"1rem"}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}><span style={{fontSize:16}}>{v.icon}</span><span style={{fontWeight:500,fontSize:14}}>{v.label}</span></div>
                  <p style={{fontSize:18,fontWeight:600,margin:"0 0 8px",color:v.color}}>{fmtUSD(total)}</p>
                  {top.length===0&&<p style={{fontSize:11,color:"#999"}}>Sin gastos</p>}
                  {top.map(([sub,amt])=>(
                    <div key={sub} style={{display:"flex",justifyContent:"space-between",fontSize:11,padding:"2px 0",borderBottom:"1px solid #f0f0f0"}}>
                      <span style={{color:"#666",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"60%"}}>{sub}</span>
                      <span style={{fontWeight:500}}>{fmtUSD(amt)}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <div style={{background:"#fff",border:"1px solid #eee",borderRadius:12,padding:"1.25rem"}}>
            <p style={{fontSize:14,fontWeight:500,margin:"0 0 10px"}}>Distribución por foco (USD Blue)</p>
            <div style={{position:"relative",height:180}}><canvas ref={chart1Ref}></canvas></div>
          </div>
        </div>
      )}

      {dashTab==="comparador"&&(
        <div id="section-comparador">
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:"1rem",flexWrap:"wrap"}}>
            <span style={{fontSize:13,color:"#666"}}>Concepto:</span>
            <select value={selectedConcepto} onChange={e=>setSelectedConcepto(e.target.value)} style={{padding:"6px 12px",borderRadius:8,border:"1px solid #ddd",fontSize:13}}>
              {allSubcats.map(s=><option key={s}>{s}</option>)}
            </select>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:"1rem"}}>
            {[["Promedio",fmtUSD(avg),"#3266ad"],["Máximo",fmtUSD(maxVal),"#e24b4a"],["Mínimo",fmtUSD(minVal),"#1d9e75"],["Meses c/dato",`${nonZero.length} / ${months.length}`,"#888"]].map(([l,v,c])=>(
              <div key={l} style={{background:"#f9f9f9",borderRadius:8,padding:".85rem",textAlign:"center"}}>
                <p style={{fontSize:11,color:"#666",margin:"0 0 4px"}}>{l}</p>
                <p style={{fontSize:14,fontWeight:500,margin:0,color:c}}>{v}</p>
              </div>
            ))}
          </div>
          <div style={{background:"#fff",border:"1px solid #eee",borderRadius:12,padding:"1.25rem",marginBottom:"1rem"}}>
            <p style={{fontSize:14,fontWeight:500,margin:"0 0 10px"}}>Evolución — {selectedConcepto} (USD Blue histórico)</p>
            <div style={{position:"relative",height:200}}><canvas ref={chart2Ref}></canvas></div>
          </div>
          <div style={{background:"#fff",border:"1px solid #eee",borderRadius:12,padding:"1.25rem"}}>
            <p style={{fontSize:14,fontWeight:500,margin:"0 0 10px"}}>Variación % mes a mes</p>
            <div style={{position:"relative",height:160}}><canvas ref={chart3Ref}></canvas></div>
          </div>
        </div>
      )}

      {dashTab==="evolucion"&&(
        <div id="section-evolucion">
          <div style={{background:"#fff",border:"1px solid #eee",borderRadius:12,padding:"1.25rem",marginBottom:"1rem"}}>
            <p style={{fontSize:14,fontWeight:500,margin:"0 0 4px"}}>Gastos vs Ingresos — {selectedYear} (USD Blue)</p>
            <div style={{position:"relative",height:250}}><canvas ref={chart1Ref}></canvas></div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:`repeat(${Object.keys(categories).length},1fr)`,gap:10}}>
            {Object.entries(categories).map(([k,v])=>(
              <div key={k} style={{background:"#f9f9f9",borderRadius:8,padding:"1rem",textAlign:"center"}}>
                <p style={{fontSize:11,color:"#666",margin:"0 0 4px"}}>{v.icon} {v.label}</p>
                <p style={{fontSize:16,fontWeight:600,margin:0,color:v.color}}>{fmtUSD(expenses.filter(e=>e.category===k).reduce((s,e)=>s+toUSD(e.amount,e.moneda,e.date),0))}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── INGRESOS TAB ────────────────────────────────────────────────────────────────

function IngresosTab({ incomes, onAdd, onEdit, onDelete, medios, onAddMedio, incomeCategories, onUpdateIncomeCategories }) {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [filterMonth, setFilterMonth] = useState("all");
  const [filterCat, setFilterCat] = useState("all");
  const [showCatEditor, setShowCatEditor] = useState(false);
  const [newCat, setNewCat] = useState("");
  const defaultForm = () => ({category:incomeCategories[0]||"Sueldo",amount:"",moneda:"ARS",date:new Date().toISOString().slice(0,10),desc:"",medio:medios[0]||"Transferencia",cuenta_destino_id:"",tipo_cambio_manual:""});
  const [form, setForm] = useState(defaultForm());

  const filtered = incomes.filter(i=>{
    const mm=filterMonth==="all"||i.date?.startsWith(`${new Date().getFullYear()}-${String(filterMonth).padStart(2,"0")}`);
    const mc=filterCat==="all"||i.category===filterCat;
    return mm&&mc;
  });
  const totalUSD = filtered.reduce((s,i)=>s+toUSD(i.amount,i.moneda,i.date),0);

  const handleSubmit = async () => {
    if(!form.amount||!form.date) return;
    const row={category:form.category,amount:parseFloat(form.amount),moneda:form.moneda,date:form.date,descripcion:form.desc,medio:form.medio};
    if(editId){
      const{error}=await supabase.from("ingresos").update(row).eq("id",editId);
      if(!error) onEdit({...row,id:editId,desc:form.desc});
    } else {
      const{data}=await supabase.from("ingresos").insert(row).select();
      if(data?.[0]){
        onAdd({...row,id:String(data[0].id),desc:form.desc});
        // Si eligió cuenta destino → generar movimiento en Ahorros
        if(form.cuenta_destino_id){
          const monto=parseFloat(form.amount);
          const tc=parseFloat(form.tipo_cambio_manual)||getBlueRate(form.date)||getLatestBlueRate()||1;
          const monto_usd=form.moneda==="USD"?monto:monto/tc;
          await supabase.from("movimientos").insert({
            fecha:form.date,
            descripcion:`${form.category}${form.desc?" — "+form.desc:""}`,
            cuenta_origen_id:null,
            cuenta_destino_id:parseInt(form.cuenta_destino_id),
            monto,
            moneda:form.moneda,
            tipo_cambio:form.moneda==="ARS"?tc:null,
            monto_usd,
          });
        }
      }
    }
    setForm(defaultForm()); setEditId(null); setShowForm(false);
  };
  const handleAddCat = () => { const v=newCat.trim(); if(!v||incomeCategories.includes(v)) return; onUpdateIncomeCategories([...incomeCategories,v]); setNewCat(""); };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem",flexWrap:"wrap",gap:8}}>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <select value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} style={{padding:"6px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:13}}>
            <option value="all">Todos los meses</option>
            {MONTHS_FULL.map((m,i)=><option key={i} value={i+1}>{m}</option>)}
          </select>
          <select value={filterCat} onChange={e=>setFilterCat(e.target.value)} style={{padding:"6px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:13}}>
            <option value="all">Todas las categorías</option>
            {incomeCategories.map(c=><option key={c}>{c}</option>)}
          </select>
          <button onClick={()=>setShowCatEditor(p=>!p)} style={{fontSize:12,padding:"5px 12px",background:"#f5f5f5",border:"1px solid #ddd",borderRadius:8,cursor:"pointer",color:"#666"}}>⚙ Categorías</button>
        </div>
        <button onClick={()=>{setShowForm(true);setEditId(null);setForm(defaultForm());}} style={{fontSize:13,padding:"6px 14px",background:"#1d9e75",border:"none",borderRadius:8,cursor:"pointer",color:"#fff",fontWeight:500}}>+ Nuevo Ingreso</button>
      </div>

      {showCatEditor&&(
        <div style={{background:"#f0faf5",border:"1px solid #1d9e7533",borderRadius:10,padding:"1rem",marginBottom:"1rem"}}>
          <p style={{fontSize:13,fontWeight:500,margin:"0 0 10px",color:"#0f6e56"}}>Categorías de ingresos</p>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
            {incomeCategories.map(c=>(<span key={c} style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:12,padding:"3px 10px",borderRadius:20,background:"#1d9e7522",color:"#0f6e56"}}>{c}<span onClick={()=>onUpdateIncomeCategories(incomeCategories.filter(x=>x!==c))} style={{cursor:"pointer",fontWeight:700,fontSize:14}}>×</span></span>))}
          </div>
          <div style={{display:"flex",gap:6}}>
            <input value={newCat} onChange={e=>setNewCat(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAddCat()} placeholder="Nueva categoría..." style={{flex:1,padding:"6px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:13}}/>
            <button onClick={handleAddCat} style={{padding:"6px 14px",background:"#1d9e75",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:13}}>+ Agregar</button>
          </div>
        </div>
      )}

      {showForm&&(
        <div style={{background:"#fff",border:"1px solid #e0e0e0",borderRadius:12,padding:"1.25rem",marginBottom:"1.5rem"}}>
          <h3 style={{margin:"0 0 1rem",fontSize:16,fontWeight:500}}>{editId?"Editar ingreso":"Nuevo ingreso"}</h3>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <div><label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Categoría</label>
              <select value={form.category} onChange={e=>setForm(p=>({...p,category:e.target.value}))} style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}>
                {incomeCategories.map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <div><label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Fecha</label>
              <input type="date" value={form.date} onChange={e=>setForm(p=>({...p,date:e.target.value}))} style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}/>
            </div>
            <div><label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Moneda</label>
              <MonedaSelector value={form.moneda} onChange={v=>setForm(p=>({...p,moneda:v,tipo_cambio_manual:""}))} date={form.date}/>
            </div>
            <div><label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Monto ({form.moneda})</label>
              <input type="number" value={form.amount} onChange={e=>setForm(p=>({...p,amount:e.target.value}))} placeholder="0" style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}/>
              {form.amount&&form.moneda==="ARS"&&<p style={{fontSize:11,color:"#999",margin:"3px 0 0"}}>≈ {fmtUSD(toUSD(parseFloat(form.amount),"ARS",form.date))}</p>}
            </div>
            <div><label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Descripción</label>
              <input type="text" value={form.desc} onChange={e=>setForm(p=>({...p,desc:e.target.value}))} placeholder="Ej: Sueldo Abril" style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}/>
            </div>
            <div><label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Medio de cobro</label>
              <MedioSelector value={form.medio} onChange={v=>setForm(p=>({...p,medio:v}))} medios={medios} onAddMedio={onAddMedio}/>
            </div>
            {/* Cuenta destino en Ahorros */}
            <CuentaDestinoSelector
              value={form.cuenta_destino_id}
              onChange={v=>setForm(p=>({...p,cuenta_destino_id:v}))}
              moneda={form.moneda}
              date={form.date}
              tcManual={form.tipo_cambio_manual}
              onTcChange={v=>setForm(p=>({...p,tipo_cambio_manual:v}))}
              amount={form.amount}
            />
          </div>
          <div style={{display:"flex",gap:8,marginTop:"1rem"}}>
            <button onClick={handleSubmit} style={{padding:"8px 20px",background:"#1d9e75",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:14,fontWeight:500}}>{editId?"Guardar cambios":"Agregar ingreso"}</button>
            <button onClick={()=>{setShowForm(false);setEditId(null);}} style={{padding:"8px 16px",background:"none",border:"1px solid #ddd",borderRadius:8,cursor:"pointer",fontSize:14,color:"#666"}}>Cancelar</button>
          </div>
        </div>
      )}

      {filtered.length===0
        ?<div style={{textAlign:"center",padding:"3rem",color:"#999",fontSize:14}}>No hay ingresos registrados.</div>
        :<div style={{display:"flex",flexDirection:"column",gap:6}}>
          {filtered.sort((a,b)=>b.date?.localeCompare(a.date)).map(i=>{
            const rate=getBlueRate(i.date)||getLatestBlueRate();
            return(
              <div key={i.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#fff",border:"1px solid #1d9e7533",borderLeft:"3px solid #1d9e75",borderRadius:8,padding:"10px 14px",gap:8}}>
                <div style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0}}>
                  <span style={{fontSize:16}}>💰</span>
                  <div style={{minWidth:0}}>
                    <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                      <span style={{fontSize:13,fontWeight:500}}>{i.category}</span>
                      <span style={{fontSize:11,padding:"2px 7px",borderRadius:20,background:"#f5f5f5",color:"#666"}}>{i.medio||"—"}</span>
                      <span style={{fontSize:11,padding:"2px 7px",borderRadius:20,background:i.moneda==="USD"?"#3266ad22":"#f0f0f0",color:i.moneda==="USD"?"#185fa5":"#888",fontWeight:i.moneda==="USD"?600:400}}>{i.moneda||"ARS"}</span>
                    </div>
                    <div style={{fontSize:11,color:"#999",marginTop:2}}>{i.desc||"—"} · {i.date} · Blue: {rate?fmtARS(rate):"—"}</div>
                  </div>
                </div>
                <div style={{display:"flex",alignItems:"center",gap:12,flexShrink:0}}>
                  <MontoDisplay amount={i.amount} moneda={i.moneda} date={i.date} size={15}/>
                  <button onClick={()=>{setForm({category:i.category,amount:String(i.amount),moneda:i.moneda||"ARS",date:i.date,desc:i.desc||"",medio:i.medio||medios[0]});setEditId(i.id);setShowForm(true);}} style={{fontSize:12,padding:"3px 10px",background:"none",border:"1px solid #ddd",borderRadius:8,cursor:"pointer",color:"#666"}}>Editar</button>
                  <button onClick={async()=>{await supabase.from("ingresos").delete().eq("id",i.id);onDelete(i.id);}} style={{fontSize:12,padding:"3px 8px",background:"none",border:"1px solid #ddd",borderRadius:8,cursor:"pointer",color:"#e24b4a"}}>✕</button>
                </div>
              </div>
            );
          })}
        </div>
      }
      {filtered.length>0&&<div style={{marginTop:12,display:"flex",justifyContent:"flex-end",gap:16,fontSize:14,fontWeight:600}}><span style={{color:"#666"}}>Total:</span><span style={{color:"#1d9e75"}}>{fmtUSD(totalUSD)}</span></div>}
    </div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────────

function Login() {
  const [email,setEmail]=useState(""); const [password,setPassword]=useState(""); const [error,setError]=useState(""); const [loading,setLoading]=useState(false);
  const handleLogin=async()=>{ setLoading(true); setError(""); const{error}=await supabase.auth.signInWithPassword({email,password}); if(error) setError("Email o contraseña incorrectos"); setLoading(false); };
  return(
    <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:"#f5f5f5"}}>
      <div style={{background:"#fff",borderRadius:16,padding:"2rem",width:340,boxShadow:"0 2px 16px rgba(0,0,0,0.08)"}}>
        <h1 style={{fontSize:22,fontWeight:500,margin:"0 0 4px"}}>Gastos del Hogar</h1>
        <p style={{fontSize:13,color:"#666",margin:"0 0 1.5rem"}}>Ingresá con tu cuenta</p>
        <label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Email</label>
        <input type="email" value={email} onChange={e=>setEmail(e.target.value)} placeholder="tu@email.com" style={{width:"100%",padding:"8px 12px",borderRadius:8,border:"1px solid #ddd",fontSize:14,marginBottom:12,boxSizing:"border-box"}}/>
        <label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Contraseña</label>
        <input type="password" value={password} onChange={e=>setPassword(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleLogin()} placeholder="••••••••" style={{width:"100%",padding:"8px 12px",borderRadius:8,border:"1px solid #ddd",fontSize:14,marginBottom:16,boxSizing:"border-box"}}/>
        {error&&<p style={{fontSize:12,color:"#e24b4a",margin:"0 0 12px"}}>{error}</p>}
        <button onClick={handleLogin} disabled={loading} style={{width:"100%",padding:"10px",background:"#3266ad",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:14,fontWeight:500}}>{loading?"Ingresando...":"Ingresar"}</button>
      </div>
    </div>
  );
}

// ─── APP PRINCIPAL ────────────────────────────────────────────────────────────────

export default function App() {
  const [session,setSession]=useState(null); const [loadingSession,setLoadingSession]=useState(true);
  const [tab,setTab]=useState("Dashboard");
  const [expenses,setExpenses]=useState([]);
  const [incomes,setIncomes]=useState([]);
  const [categories,setCategories]=useState(DEFAULT_CATEGORIES);
  const [incomeCategories,setIncomeCategories]=useState(DEFAULT_INCOME_CATEGORIES);
  const [medios,setMedios]=useState(BASE_MEDIOS);
  const [loadingData,setLoadingData]=useState(false);
  const [showForm,setShowForm]=useState(false);
  const [showCatEditor,setShowCatEditor]=useState(false);
  const [editId,setEditId]=useState(null);
  const [form,setForm]=useState({category:"hogar",subcat:"Luz",amount:"",moneda:"ARS",date:new Date().toISOString().slice(0,10),desc:"",dueDate:"",recurring:false,fileName:"",medio:"Transferencia",pagado:false,cuenta_origen_id:"",tipo_cambio_manual:""});
  const [calMonth,setCalMonth]=useState(new Date().getMonth()); const [calYear,setCalYear]=useState(new Date().getFullYear());
  const [filterCat,setFilterCat]=useState("all"); const [filterMonth,setFilterMonth]=useState("all");
  const [filterPagado,setFilterPagado]=useState("all"); const [filterSubcat,setFilterSubcat]=useState("all");
  const [filterMedio,setFilterMedio]=useState("all");
  const [selectedIds,setSelectedIds]=useState(new Set());
  const [deletingBulk,setDeletingBulk]=useState(false);
  const [aiLoading,setAiLoading]=useState(false); const [aiResult,setAiResult]=useState("");
  const [importMsg,setImportMsg]=useState("");
  const fileRef=useRef(); const importRef=useRef();

  useEffect(()=>{ supabase.auth.getSession().then(({data:{session}})=>{setSession(session);setLoadingSession(false);}); const{data:{subscription}}=supabase.auth.onAuthStateChange((_e,s)=>setSession(s)); return()=>subscription.unsubscribe(); },[]);
  useEffect(()=>{ if(session){loadExpenses();loadCategories();loadIncomes();loadMedios();loadIncomeCategories();loadBlueHistorico();} },[session]);
  useEffect(()=>{ if(tab==="Dashboard"||tab==="Análisis"){ if(!window.Chart){ const s=document.createElement("script"); s.src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"; s.async=true; document.head.appendChild(s); } } },[tab]);

  const loadExpenses=async()=>{ setLoadingData(true); const{data,error}=await supabase.from("gastos").select("*").order("id",{ascending:false}); if(!error&&data) setExpenses(data.map(e=>({id:String(e.id),category:e.category,subcat:e.subcat,amount:e.amount,moneda:e.moneda||"ARS",date:e.date,dueDate:e.due_date,desc:e.descripcion,medio:e.medio,pagado:e.pagado,recurring:e.recurring,fileName:e.file_name}))); setLoadingData(false); };
  const loadIncomes=async()=>{ const{data,error}=await supabase.from("ingresos").select("*").order("id",{ascending:false}); if(!error&&data) setIncomes(data.map(i=>({id:String(i.id),category:i.category,amount:i.amount,moneda:i.moneda||"ARS",date:i.date,desc:i.descripcion,medio:i.medio}))); };
  const loadCategories=async()=>{ const{data}=await supabase.from("categorias").select("*"); if(data&&data.length){const cats={}; data.forEach(r=>{if(!cats[r.foco])cats[r.foco]={label:r.foco_label,icon:r.foco_icon,color:r.foco_color,subcats:[]};cats[r.foco].subcats.push(r.subcat);}); setCategories({...DEFAULT_CATEGORIES,...cats});} };
  const loadMedios=async()=>{ const{data}=await supabase.from("medios_pago").select("nombre"); if(data&&data.length){const extras=data.map(d=>d.nombre).filter(m=>!BASE_MEDIOS.includes(m)); setMedios([...BASE_MEDIOS,...extras]);} };
  const loadBlueHistorico=async()=>{ const{data}=await supabase.from("blue_historico").select("fecha,valor"); if(data&&data.length) mergeBlueData(data); };
  const loadIncomeCategories=async()=>{ const{data}=await supabase.from("categorias_ingreso").select("nombre"); if(data&&data.length) setIncomeCategories(data.map(d=>d.nombre)); };

  const handleAddMedio=async(nombre)=>{ if(medios.includes(nombre)) return; setMedios(p=>[...p,nombre]); try{await supabase.from("medios_pago").insert({nombre});}catch{} };
  const handleUpdateIncomeCategories=async(cats)=>{ setIncomeCategories(cats); try{await supabase.from("categorias_ingreso").delete().neq("id",0); if(cats.length) await supabase.from("categorias_ingreso").insert(cats.map(nombre=>({nombre})));}catch{} };
  const handleImportCSV=async(e)=>{ const f=e.target.files[0]; if(!f) return; setImportMsg("Importando..."); const text=await f.text(); const lines=text.split("\n").filter(l=>l.trim()); const rows=lines.slice(1).map(line=>{const cols=line.split(",").map(c=>c.replace(/^"|"$/g,"").trim()); const pd=d=>d?.includes("/")?d.split("/").reverse().join("-"):d; return{category:cols[1]==="Hogar"?"hogar":cols[1]==="Autos"?"autos":"hijos",subcat:cols[2],descripcion:cols[3],amount:parseFloat(cols[4])||0,moneda:cols[5]||"ARS",date:pd(cols[6]),due_date:pd(cols[7])||null,medio:cols[8],pagado:cols[9]==="Pagado",recurring:cols[10]==="Sí",file_name:cols[11]||""};}).filter(r=>r.subcat&&r.amount); const{error}=await supabase.from("gastos").insert(rows); if(error) setImportMsg("Error: "+error.message); else{setImportMsg(`✓ ${rows.length} gastos importados`);loadExpenses();} setTimeout(()=>setImportMsg(""),4000); e.target.value=""; };
  const togglePagado=async(id)=>{ const e=expenses.find(x=>x.id===id); await supabase.from("gastos").update({pagado:!e.pagado}).eq("id",id); setExpenses(p=>p.map(x=>x.id===id?{...x,pagado:!x.pagado}:x)); };
  const wakeBackend=async()=>{ try{await fetch(`${API_URL}/`);}catch{} };
  const handleFile=async(e)=>{ const f=e.target.files[0]; if(!f) return; setForm(p=>({...p,fileName:f.name})); if(f.type==="application/pdf"||f.type.startsWith("image/")){setAiLoading(true);setAiResult("Despertando servidor...");await wakeBackend();setAiResult("Analizando archivo con IA...");try{const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(f);}); let parsed=null; for(let i=1;i<=3;i++){try{setAiResult(`Analizando... (intento ${i}/3)`);const resp=await fetch(`${API_URL}/api/analyze`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({base64:b64,mediaType:f.type}),signal:AbortSignal.timeout(60000)});parsed=await resp.json();break;}catch{if(i<3)await new Promise(r=>setTimeout(r,3000));}} if(parsed&&!parsed.error){setAiResult("✓ "+(parsed.descripcion||"Archivo procesado"));setForm(prev=>({...prev,amount:parsed.monto?String(parsed.monto):prev.amount,date:parsed.fecha||prev.date,dueDate:parsed.vencimiento||prev.dueDate,desc:parsed.descripcion||prev.desc,subcat:parsed.categoria_sugerida||prev.subcat,category:parsed.foco_sugerido||prev.category}));}else setAiResult("No se pudo extraer datos. Completá manualmente.");}catch{setAiResult("Error procesando el archivo.");} setAiLoading(false);}};
  const handleSubmit=async()=>{
    if(!form.amount||!form.date) return;
    const row={category:form.category,subcat:form.subcat,amount:parseFloat(form.amount),moneda:form.moneda,date:form.date,due_date:form.dueDate||null,descripcion:form.desc,medio:form.medio,pagado:form.pagado,recurring:form.recurring,file_name:form.fileName};
    const esTarjeta = MEDIOS_TARJETA.includes(form.medio) || medios.filter(m=>!BASE_MEDIOS.includes(m)).some(m=>m===form.medio&&m.toLowerCase().includes("visa")||m.toLowerCase().includes("amex")||m.toLowerCase().includes("master"));
    if(editId){
      await supabase.from("gastos").update(row).eq("id",editId);
      setExpenses(p=>p.map(e=>e.id===editId?{...form,id:editId,amount:parseFloat(form.amount)}:e));
      setEditId(null);
    } else {
      const{data}=await supabase.from("gastos").insert(row).select();
      if(data?.[0]){
        setExpenses(p=>[{...form,id:String(data[0].id),amount:parseFloat(form.amount)},...p]);
        // Si no es tarjeta y tiene cuenta origen → generar movimiento automático en Ahorros
        if(!esTarjeta && form.cuenta_origen_id){
          const monto=parseFloat(form.amount);
          const tc=parseFloat(form.tipo_cambio_manual)||getBlueRate(form.date)||getLatestBlueRate()||1;
          const monto_usd=form.moneda==="USD"?monto:monto/tc;
          await supabase.from("movimientos").insert({
            fecha:form.date,
            descripcion:`${form.subcat}${form.desc?" — "+form.desc:""}`,
            cuenta_origen_id:parseInt(form.cuenta_origen_id),
            cuenta_destino_id:null,
            monto,
            moneda:form.moneda,
            tipo_cambio:form.moneda==="ARS"?tc:null,
            monto_usd,
          });
        }
      }
    }
    const firstCat=Object.keys(categories)[0];
    setForm({category:firstCat,subcat:Object.values(categories)[0].subcats[0]||"",amount:"",moneda:"ARS",date:new Date().toISOString().slice(0,10),desc:"",dueDate:"",recurring:false,fileName:"",medio:medios[0]||"Transferencia",pagado:false,cuenta_origen_id:"",tipo_cambio_manual:""});
    setAiResult(""); setShowForm(false);
  };
  const del=async(id)=>{ await supabase.from("gastos").delete().eq("id",id); setExpenses(p=>p.filter(e=>e.id!==id)); };
  const edit=e=>{ setForm({...e,amount:String(e.amount)}); setEditId(e.id); setShowForm(true); };
  const filtered=expenses.filter(e=>{ const mc=filterCat==="all"||e.category===filterCat; const mm=filterMonth==="all"||e.date?.startsWith(`${new Date().getFullYear()}-${String(filterMonth).padStart(2,"0")}`); const mp=filterPagado==="all"||(filterPagado==="pagado"&&e.pagado)||(filterPagado==="pendiente"&&!e.pagado); const ms=filterSubcat==="all"||e.subcat===filterSubcat; const med=filterMedio==="all"||e.medio===filterMedio; return mc&&mm&&mp&&ms&&med; });
  const getDueDates=()=>{ const result={}; expenses.forEach(e=>{const d=e.dueDate||e.date; if(!d) return; const eYear=parseInt(d.slice(0,4)),eMonth=parseInt(d.slice(5,7))-1; if(eYear!==calYear||eMonth!==calMonth) return; if(!result[d]) result[d]=[]; result[d].push(e);}); return result; };
  const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
  const firstDay=new Date(calYear,calMonth,1).getDay();
  const dueDates=getDueDates();

  if(loadingSession) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",fontSize:14,color:"#666"}}>Cargando...</div>;
  if(!session) return <Login/>;
  const firstCat=Object.keys(categories)[0];

  return(
    <div style={{fontFamily:"system-ui,sans-serif",maxWidth:960,margin:"0 auto",padding:"1rem",color:"#1a1a1a"}}>
      {showCatEditor&&<CategoryEditor categories={categories} onClose={()=>setShowCatEditor(false)} onSave={cats=>setCategories(cats)}/>}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.25rem",flexWrap:"wrap",gap:8}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:500,margin:0}}>Gastos del Hogar</h1>
          <p style={{fontSize:12,color:"#666",margin:"2px 0 0"}}>{session.user.email}</p>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
          <TipoCambioWidget/>
          <input ref={importRef} type="file" accept=".csv" onChange={handleImportCSV} style={{display:"none"}}/>
          <button onClick={()=>importRef.current.click()} style={{fontSize:13,padding:"6px 14px",background:"#f5f5f5",border:"1px solid #ddd",borderRadius:8,cursor:"pointer"}}>↑ CSV</button>
          {importMsg&&<span style={{fontSize:12,color:importMsg.startsWith("✓")?"#1d9e75":"#e24b4a"}}>{importMsg}</span>}
          <button onClick={async()=>{
            // Export All: descarga 3 CSVs uno por uno
            exportCSV([["Foco","Categoría","Descripción","Monto","Moneda","Fecha","Vencimiento","Medio","Estado","Recurrente"],...expenses.map(e=>[categories[e.category]?.label,e.subcat,e.desc,e.amount,e.moneda||"ARS",e.date,e.dueDate,e.medio,e.pagado?"Pagado":"Pendiente",e.recurring?"Sí":"No"])],"export_gastos");
            await new Promise(r=>setTimeout(r,500));
            exportCSV([["Categoría","Descripción","Monto","Moneda","Fecha","Medio"],...incomes.map(i=>[i.category,i.desc,i.amount,i.moneda||"ARS",i.date,i.medio])],"export_ingresos");
            await new Promise(r=>setTimeout(r,500));
            const{data:movs}=await supabase.from("movimientos").select("*").order("fecha",{ascending:false});
            const{data:ctas}=await supabase.from("cuentas").select("*");
            if(movs&&ctas) exportCSV([["Fecha","Descripción","Origen","Destino","Monto","Moneda","TC","Monto USD"],...movs.map(m=>[m.fecha,m.descripcion||"",ctas.find(c=>c.id===m.cuenta_origen_id)?.nombre||"externo",ctas.find(c=>c.id===m.cuenta_destino_id)?.nombre||"externo",m.monto,m.moneda||"USD",m.tipo_cambio||"",m.monto_usd])],"export_movimientos");
          }} style={{fontSize:13,padding:"6px 14px",background:"#1a4a8a",border:"none",borderRadius:8,cursor:"pointer",color:"#fff",fontWeight:500}}>↓ Export All</button>
          <button onClick={()=>supabase.auth.signOut()} style={{fontSize:13,padding:"6px 14px",background:"#f5f5f5",border:"1px solid #ddd",borderRadius:8,cursor:"pointer"}}>Salir</button>
          <button onClick={()=>{setShowForm(true);setEditId(null);setAiResult("");setForm({category:firstCat,subcat:categories[firstCat]?.subcats[0]||"",amount:"",moneda:"ARS",date:new Date().toISOString().slice(0,10),desc:"",dueDate:"",recurring:false,fileName:"",medio:medios[0]||"Transferencia",pagado:false,cuenta_origen_id:"",tipo_cambio_manual:""});}} style={{fontSize:13,padding:"6px 14px",background:"#3266ad",border:"none",borderRadius:8,cursor:"pointer",color:"#fff",fontWeight:500}}>+ Nuevo Gasto</button>
        </div>
      </div>

      <div style={{display:"flex",gap:4,marginBottom:"1.5rem",borderBottom:"1px solid #eee"}}>
        {TABS.map(t=><button key={t} onClick={()=>setTab(t)} style={{padding:"8px 18px",fontSize:14,background:"none",border:"none",borderBottom:tab===t?"2px solid #3266ad":"2px solid transparent",color:tab===t?"#3266ad":"#666",cursor:"pointer",fontWeight:tab===t?500:400}}>{t}</button>)}
      </div>

      {showForm&&(
        <div style={{background:"#fff",border:"1px solid #e0e0e0",borderRadius:12,padding:"1.25rem",marginBottom:"1.5rem"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem"}}>
            <h3 style={{margin:0,fontSize:16,fontWeight:500}}>{editId?"Editar gasto":"Nuevo gasto"}</h3>
            <button onClick={()=>setShowCatEditor(true)} style={{fontSize:12,padding:"4px 12px",background:"#f0f4ff",border:"1px solid #3266ad44",borderRadius:8,cursor:"pointer",color:"#3266ad"}}>⚙ Editar categorías</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <div><label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Foco</label>
              <select value={form.category} onChange={e=>setForm(p=>({...p,category:e.target.value,subcat:categories[e.target.value]?.subcats[0]||""}))} style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}>
                {Object.entries(categories).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </div>
            <div><label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Categoría</label>
              <select value={form.subcat} onChange={e=>setForm(p=>({...p,subcat:e.target.value}))} style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}>
                {(categories[form.category]?.subcats||[]).map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
            <div><label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Fecha de pago</label>
              <input type="date" value={form.date} onChange={e=>setForm(p=>({...p,date:e.target.value}))} style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}/>
            </div>
            <div><label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Moneda</label>
              <MonedaSelector value={form.moneda} onChange={v=>setForm(p=>({...p,moneda:v}))} date={form.date}/>
            </div>
            <div><label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Monto ({form.moneda})</label>
              <input type="number" value={form.amount} onChange={e=>setForm(p=>({...p,amount:e.target.value}))} placeholder="0" style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}/>
              {form.amount&&form.moneda==="ARS"&&<p style={{fontSize:11,color:"#999",margin:"3px 0 0"}}>≈ {fmtUSD(toUSD(parseFloat(form.amount),"ARS",form.date))}</p>}
            </div>
            <div><label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Fecha de vencimiento</label>
              <input type="date" value={form.dueDate} onChange={e=>setForm(p=>({...p,dueDate:e.target.value}))} style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}/>
            </div>
            <div><label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Descripción</label>
              <input type="text" value={form.desc} onChange={e=>setForm(p=>({...p,desc:e.target.value}))} placeholder="Ej: Factura Edesur Febrero" style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}/>
            </div>
            <div><label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Medio de pago</label>
              <MedioSelector value={form.medio} onChange={v=>setForm(p=>({...p,medio:v,cuenta_origen_id:"",tipo_cambio_manual:""}))} medios={medios} onAddMedio={handleAddMedio}/>
            </div>
            <div><label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Estado</label>
              <select value={form.pagado?"1":"0"} onChange={e=>setForm(p=>({...p,pagado:e.target.value==="1"}))} style={{width:"100%",padding:"7px 10px",borderRadius:8,border:`1px solid ${form.pagado?"#1d9e75":"#e24b4a"}`,fontSize:14,background:form.pagado?"#f0faf5":"#fef2f2",color:form.pagado?"#0f6e56":"#a32d2d",fontWeight:500,boxSizing:"border-box"}}>
                <option value="0">🔴 Pendiente</option><option value="1">🟢 Pagado</option>
              </select>
            </div>
            {/* Campos extra para gastos no-tarjeta */}
            {!MEDIOS_TARJETA.includes(form.medio)&&(
              <CuentaOrigenSelector
                value={form.cuenta_origen_id}
                onChange={v=>setForm(p=>({...p,cuenta_origen_id:v}))}
                moneda={form.moneda}
                date={form.date}
                tcManual={form.tipo_cambio_manual}
                onTcChange={v=>setForm(p=>({...p,tipo_cambio_manual:v}))}
                amount={form.amount}
              />
            )}
          </div>
          <div style={{marginTop:12}}><label style={{fontSize:12,color:"#666"}}><input type="checkbox" checked={form.recurring} onChange={e=>setForm(p=>({...p,recurring:e.target.checked}))} style={{marginRight:4}}/>Gasto recurrente mensual</label></div>
          <div style={{marginTop:12}}>
            <label style={{fontSize:12,color:"#666",display:"block",marginBottom:6}}>Adjuntar factura o resumen (PDF o imagen)</label>
            <input ref={fileRef} type="file" accept=".pdf,image/*" onChange={handleFile} style={{display:"none"}}/>
            <button onClick={()=>fileRef.current.click()} disabled={aiLoading} style={{fontSize:13,padding:"6px 14px",background:"#f5f5f5",border:"1px solid #ddd",borderRadius:8,cursor:"pointer"}}>{form.fileName?`📎 ${form.fileName}`:"📎 Subir archivo"}</button>
            {aiLoading&&<span style={{fontSize:12,color:"#3266ad",marginLeft:12}}>⏳ {aiResult}</span>}
            {!aiLoading&&aiResult&&<span style={{fontSize:12,color:aiResult.startsWith("✓")?"#1d9e75":"#e24b4a",marginLeft:12}}>{aiResult}</span>}
          </div>
          <div style={{display:"flex",gap:8,marginTop:"1rem"}}>
            <button onClick={handleSubmit} style={{padding:"8px 20px",background:"#3266ad",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:14,fontWeight:500}}>{editId?"Guardar cambios":"Agregar gasto"}</button>
            <button onClick={()=>{setShowForm(false);setEditId(null);}} style={{padding:"8px 16px",background:"none",border:"1px solid #ddd",borderRadius:8,cursor:"pointer",fontSize:14,color:"#666"}}>Cancelar</button>
          </div>
        </div>
      )}

      {tab==="Dashboard"&&<Dashboard expenses={expenses} incomes={incomes} categories={categories}/>}

      {tab==="Gastos"&&(
        <div id="section-gastos">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"0.75rem",flexWrap:"wrap",gap:8}}>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <select value={filterCat} onChange={e=>setFilterCat(e.target.value)} style={{padding:"6px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:13}}><option value="all">Todos los focos</option>{Object.entries(categories).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}</select>
              <select value={filterMonth} onChange={e=>setFilterMonth(e.target.value)} style={{padding:"6px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:13}}><option value="all">Todos los meses</option>{MONTHS_FULL.map((m,i)=><option key={i} value={i+1}>{m}</option>)}</select>
              <select value={filterPagado} onChange={e=>setFilterPagado(e.target.value)} style={{padding:"6px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:13}}><option value="all">Todos los estados</option><option value="pagado">Solo pagados</option><option value="pendiente">Solo pendientes</option></select>
              <select value={filterSubcat} onChange={e=>setFilterSubcat(e.target.value)} style={{padding:"6px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:13}}><option value="all">Todas las categorías</option>{[...new Set(expenses.map(e=>e.subcat))].sort().map(s=><option key={s}>{s}</option>)}</select>
              <select value={filterMedio} onChange={e=>{setFilterMedio(e.target.value);setSelectedIds(new Set());}} style={{padding:"6px 10px",borderRadius:8,border:`1px solid ${filterMedio!=="all"?"#d85a30":"#ddd"}`,fontSize:13,background:filterMedio!=="all"?"#fff8f5":"#fff",color:filterMedio!=="all"?"#d85a30":"inherit",fontWeight:filterMedio!=="all"?500:400}}>
                <option value="all">Todos los medios</option>
                {[...new Set(expenses.map(e=>e.medio).filter(Boolean))].sort().map(m=><option key={m}>{m}</option>)}
              </select>
            </div>
            <ExportButtons onCSV={()=>{const rows=[["ID","Foco","Subcategoría","Descripción","Monto","Moneda","Blue del día","USD equiv.","Fecha","Vencimiento","Medio","Estado","Recurrente"]]; filtered.forEach(e=>{const r=getBlueRate(e.date)||getLatestBlueRate();rows.push([e.id,categories[e.category]?.label,e.subcat,e.desc,fmtRaw(e.amount),e.moneda||"ARS",r||"",toUSD(e.amount,e.moneda,e.date).toFixed(2),e.date,e.dueDate,e.medio,e.pagado?"Pagado":"Pendiente",e.recurring?"Sí":"No"]);}); exportCSV(rows,"gastos_hogar");}} onPDF={()=>exportPDF("Listado de Gastos","gastos_hogar","section-gastos")}/>
          </div>

          {/* ── Barra de selección múltiple ── */}
          {filtered.length>0&&(
            <div style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:"#f9f9f9",borderRadius:8,marginBottom:"0.75rem",flexWrap:"wrap"}}>
              <label style={{display:"flex",alignItems:"center",gap:6,fontSize:13,cursor:"pointer",userSelect:"none"}}>
                <input type="checkbox"
                  checked={selectedIds.size>0&&filtered.every(e=>selectedIds.has(e.id))}
                  ref={el=>{ if(el) el.indeterminate=selectedIds.size>0&&!filtered.every(e=>selectedIds.has(e.id)); }}
                  onChange={e=>{ if(e.target.checked) setSelectedIds(new Set(filtered.map(e=>e.id))); else setSelectedIds(new Set()); }}
                />
                {selectedIds.size>0?`${selectedIds.size} seleccionados`:"Seleccionar todos"}
              </label>
              {selectedIds.size>0&&(
                <>
                  <span style={{color:"#ddd"}}>|</span>
                  <button
                    disabled={deletingBulk}
                    onClick={async()=>{
                      if(!confirm(`¿Eliminar ${selectedIds.size} gastos? Esta acción no se puede deshacer.`)) return;
                      setDeletingBulk(true);
                      const ids=[...selectedIds];
                      const{error}=await supabase.from("gastos").delete().in("id",ids.map(Number));
                      if(!error){ setExpenses(p=>p.filter(e=>!selectedIds.has(e.id))); setSelectedIds(new Set()); }
                      setDeletingBulk(false);
                    }}
                    style={{fontSize:13,padding:"4px 14px",background:"#e24b4a",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontWeight:500}}
                  >{deletingBulk?"Eliminando...":"🗑 Eliminar seleccionados"}</button>
                  <button onClick={()=>setSelectedIds(new Set())} style={{fontSize:12,padding:"4px 10px",background:"none",border:"1px solid #ddd",borderRadius:8,cursor:"pointer",color:"#666"}}>Cancelar</button>
                </>
              )}
              {filterMedio!=="all"&&selectedIds.size===0&&(
                <span style={{fontSize:12,color:"#d85a30"}}>Filtrando por: <strong>{filterMedio}</strong> — {filtered.length} gastos</span>
              )}
            </div>
          )}

          {loadingData?<p style={{textAlign:"center",color:"#999",fontSize:14}}>Cargando...</p>
          :filtered.length===0?<div style={{textAlign:"center",padding:"3rem",color:"#999",fontSize:14}}>No hay gastos que coincidan.</div>
          :<div style={{display:"flex",flexDirection:"column",gap:6}}>
            {filtered.sort((a,b)=>b.date?.localeCompare(a.date)).map(e=>{
              const cat=categories[e.category]; const rate=getBlueRate(e.date)||getLatestBlueRate();
              const isSelected=selectedIds.has(e.id);
              return(
                <div key={e.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:isSelected?"#f0f4ff":"#fff",border:`1px solid ${isSelected?"#3266ad":e.pagado?"#1d9e7533":"#e24b4a33"}`,borderLeft:`3px solid ${isSelected?"#3266ad":e.pagado?"#1d9e75":"#e24b4a"}`,borderRadius:8,padding:"10px 14px",gap:8}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0}}>
                    <input type="checkbox" checked={isSelected} onChange={ev=>{ const s=new Set(selectedIds); ev.target.checked?s.add(e.id):s.delete(e.id); setSelectedIds(s); }} style={{flexShrink:0,cursor:"pointer"}}/>
                    <span style={{fontSize:16}}>{cat?.icon}</span>
                    <div style={{minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                        <span style={{fontSize:13,fontWeight:500}}>{e.subcat}</span>
                        <span style={{fontSize:11,padding:"2px 7px",borderRadius:20,background:(cat?.color||"#888")+"22",color:cat?.color||"#888"}}>{cat?.label}</span>
                        <span style={{fontSize:11,padding:"2px 7px",borderRadius:20,background:"#f5f5f5",color:"#666"}}>{e.medio||"—"}</span>
                        <span style={{fontSize:11,padding:"2px 7px",borderRadius:20,background:e.moneda==="USD"?"#3266ad22":"#f0f0f0",color:e.moneda==="USD"?"#185fa5":"#888",fontWeight:e.moneda==="USD"?600:400}}>{e.moneda||"ARS"}</span>
                        {e.recurring&&<span style={{fontSize:11,padding:"2px 7px",borderRadius:20,background:"#3266ad22",color:"#185fa5"}}>Recurrente</span>}
                      </div>
                      <div style={{fontSize:11,color:"#999",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.desc||"—"} · {e.date}{rate?` · Blue: ${fmtARS(rate)}`:""}{e.dueDate?` · Vence: ${e.dueDate}`:""}</div>
                    </div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                    <MontoDisplay amount={e.amount} moneda={e.moneda} date={e.date}/>
                    <span onClick={()=>togglePagado(e.id)} style={badgeStyle(e.pagado)}>{e.pagado?"✓ Pagado":"● Pendiente"}</span>
                    <button onClick={()=>edit(e)} style={{fontSize:12,padding:"3px 10px",background:"none",border:"1px solid #ddd",borderRadius:8,cursor:"pointer",color:"#666"}}>Editar</button>
                    <button onClick={()=>del(e.id)} style={{fontSize:12,padding:"3px 8px",background:"none",border:"1px solid #ddd",borderRadius:8,cursor:"pointer",color:"#e24b4a"}}>✕</button>
                  </div>
                </div>
              );
            })}
          </div>}
          {filtered.length>0&&<div style={{marginTop:12,textAlign:"right",fontWeight:500,fontSize:14,color:"#666"}}>
            Total ARS: {fmtARS(filtered.filter(e=>(e.moneda||"ARS")==="ARS").reduce((s,e)=>s+e.amount,0))} · USD equiv.: {fmtUSD(filtered.reduce((s,e)=>s+toUSD(e.amount,e.moneda,e.date),0))}
          </div>}
        </div>
      )}

      {tab==="Ingresos"&&<IngresosTab incomes={incomes} onAdd={i=>setIncomes(p=>[i,...p])} onEdit={i=>setIncomes(p=>p.map(x=>x.id===i.id?{...x,...i}:x))} onDelete={id=>setIncomes(p=>p.filter(x=>x.id!==id))} medios={medios} onAddMedio={handleAddMedio} incomeCategories={incomeCategories} onUpdateIncomeCategories={handleUpdateIncomeCategories}/>}

      {tab==="Calendario"&&(
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
              const day=i+1; const key=`${calYear}-${String(calMonth+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
              const items=dueDates[key]||[]; const today=new Date();
              const isToday=today.getFullYear()===calYear&&today.getMonth()===calMonth&&today.getDate()===day;
              return(
                <div key={day} style={{minHeight:72,padding:"4px 5px",border:"1px solid #eee",borderRadius:8,background:isToday?"#eff6ff":"#fff"}}>
                  <div style={{fontSize:12,fontWeight:isToday?500:400,color:isToday?"#3266ad":"#999",marginBottom:3}}>{day}</div>
                  {items.map((e,idx)=>(<div key={idx} style={{fontSize:10,padding:"2px 4px",borderRadius:3,background:e.pagado?"#f0faf5":"#fef2f2",color:e.pagado?"#0f6e56":"#a32d2d",border:`1px solid ${e.pagado?"#1d9e7533":"#e24b4a33"}`,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.subcat}</div>))}
                </div>
              );
            })}
          </div>
          <div style={{display:"flex",gap:16,marginTop:12,fontSize:12,color:"#666"}}><span>🟢 Pagado</span><span>🔴 Pendiente</span></div>
        </div>
      )}

      {tab==="Análisis"&&(
        <div id="section-analisis">
          <div style={{display:"flex",justifyContent:"flex-end",marginBottom:"1rem"}}>
            <ExportButtons onCSV={()=>{const months=[...new Set(expenses.map(e=>e.date?.slice(0,7)).filter(Boolean))].sort().reverse().slice(0,6); const rows=[["Foco",...months,"Total"]]; Object.entries(categories).forEach(([k,v])=>{const totals=months.map(m=>expenses.filter(e=>e.category===k&&e.date?.startsWith(m)).reduce((s,e)=>s+toUSD(e.amount,e.moneda,e.date),0)); const total=totals.reduce((a,b)=>a+b,0); if(total>0) rows.push([v.label,...totals.map(t=>t.toFixed(2)),total.toFixed(2)]);}); exportCSV(rows,"analisis_hogar");}} onPDF={()=>exportPDF("Análisis","analisis_hogar","section-analisis")}/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
            <div style={{background:"#fff",border:"1px solid #eee",borderRadius:12,padding:"1.25rem"}}>
              <h3 style={{margin:"0 0 1rem",fontSize:15,fontWeight:500}}>Distribución por foco (USD Blue)</h3>
              {expenses.length===0?<p style={{fontSize:13,color:"#999"}}>Sin datos.</p>
              :Object.entries(categories).map(([k,v])=>{
                const tot=expenses.filter(e=>e.category===k).reduce((s,e)=>s+toUSD(e.amount,e.moneda,e.date),0);
                const total=expenses.reduce((s,e)=>s+toUSD(e.amount,e.moneda,e.date),0);
                const pct=total>0?Math.round((tot/total)*100):0;
                return(<div key={k} style={{marginBottom:14}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:4}}><span>{v.icon} {v.label}</span><span style={{fontWeight:500}}>{fmtUSD(tot)} ({pct}%)</span></div>
                  <div style={{height:8,background:"#f0f0f0",borderRadius:4}}><div style={{height:"100%",width:`${pct}%`,background:v.color,borderRadius:4}}></div></div>
                </div>);
              })}
            </div>
            <div style={{background:"#fff",border:"1px solid #eee",borderRadius:12,padding:"1.25rem"}}>
              <h3 style={{margin:"0 0 4px",fontSize:15,fontWeight:500}}>Resumen por mes (USD Blue)</h3>
              <p style={{fontSize:12,color:"#999",margin:"0 0 1rem"}}>Hacé clic en un foco para ver el detalle</p>
              <ExpandableTable expenses={expenses} categories={categories}/>
            </div>
          </div>
        </div>
      )}

      {tab==="Ahorros"&&<AhorrosTab key={tab} expenses={expenses} categories={categories}/>}
    </div>
  );
}

// ─── IMPORTER DE RESUMEN DE TARJETA ──────────────────────────────────────────────

// Mapeo de categorías del Excel a focos/subcats de la app
const CATEGORIA_MAP = {
  // Hogar
  "Comida":                  { category:"hogar",    subcat:"Comida" },
  "Gastronomia":             { category:"hogar",    subcat:"Salidas" },
  "Nube":                    { category:"hogar",    subcat:"Nube" },
  "Suscripciones / digital": { category:"hogar",    subcat:"Nube" },
  "Movistar Celular":        { category:"hogar",    subcat:"Movistar" },
  "Seguro":                  { category:"hogar",    subcat:"Seguro Hogar" },
  "Librería":                { category:"hijos",    subcat:"Otros" },
  "Compras Juguetes":        { category:"hijos",    subcat:"Otros" },
  "Socio River":             { category:"hijos",    subcat:"Club Santa Barbara" },
  // Autos
  "Combustible":             { category:"autos",    subcat:"Tiguan Nafta" },
  "Peajes":                  { category:"autos",    subcat:"Peajes" },
  // Otros
  "Compras Ropa":            { category:"otros",    subcat:"Compras Ropa" },
  "Compras online":          { category:"otros",    subcat:"Otros" },
  "Matercell":               { category:"hogar",    subcat:"Matercell" },
  "Comision":                { category:"otros",    subcat:"Comision Tarjeta" },
  "Impuesto":                { category:"otros",    subcat:"Impuesto Tarjeta" },
  "Interes":                 { category:"otros",    subcat:"Comision Tarjeta" },
  "Otros":                   { category:"otros",    subcat:"Otros" },
};

// Convierte fecha serial de Excel a ISO string YYYY-MM-DD
function excelSerialToISO(serial) {
  if (!serial || isNaN(serial)) return null;
  const d = new Date(Math.round((serial - 25569) * 86400 * 1000));
  return d.toISOString().slice(0, 10);
}

function TarjetaImporter({ cuentas, categories, onDone }) {
  const [step, setStep] = useState("upload");
  const [cuentaId, setCuentaId] = useState("");
  const [rows, setRows] = useState([]);
  const [msg, setMsg] = useState("");
  const [resumenes, setResumenes] = useState([]); // períodos cargados por tarjeta
  const [loadingResumenes, setLoadingResumenes] = useState(false);
  const fileRef = useRef();
  const tarjetas = cuentas.filter(c => c.tipo === "tarjeta");
  const allSubcats = Object.entries(categories).flatMap(([k, v]) => v.subcats.map(s => ({ category: k, subcat: s, label: `${v.icon} ${v.label} › ${s}` })));

  // Cargar resúmenes existentes cuando se selecciona tarjeta
  useEffect(() => {
    if (!cuentaId) { setResumenes([]); return; }
    const cuenta = cuentas.find(c => String(c.id) === String(cuentaId));
    if (!cuenta) return;
    setLoadingResumenes(true);
    supabase.from("gastos").select("id,date,amount").eq("medio", cuenta.nombre)
      .then(({ data }) => {
        if (!data?.length) { setResumenes([]); setLoadingResumenes(false); return; }
        // Agrupar por mes
        const byMonth = {};
        data.forEach(g => {
          const mes = g.date?.slice(0, 7);
          if (!mes) return;
          if (!byMonth[mes]) byMonth[mes] = { ids:[], count:0, totalARS:0 };
          byMonth[mes].ids.push(g.id);
          byMonth[mes].count++;
          byMonth[mes].totalARS += Math.abs(g.amount || 0);
        });
        setResumenes(Object.entries(byMonth).sort(([a],[b])=>b.localeCompare(a)).map(([mes, v]) => ({ mes, ...v })));
        setLoadingResumenes(false);
      });
  }, [cuentaId]);

  const handleEliminarResumen = async (mes, ids) => {
    if (!confirm(`¿Eliminar los ${ids.length} gastos de ${mes}? Esta acción no se puede deshacer.`)) return;
    await supabase.from("gastos").delete().in("id", ids);
    setResumenes(p => p.filter(r => r.mes !== mes));
  };

  // ── Parser de texto PDF del resumen ICBC VISA ──────────────────────
  const parsePDFText = (text, medioNombre) => {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    const results = [];

    // Palabras que indican que la línea NO es un gasto
    const SKIP_PREFIXES = [
      'SALDO ANTERIOR','SU PAGO','DEV.IMP','PAGO MINIMO','SALDO ACTUAL','TARJETA','PAGINA',
      'TITULAR','Plan V','cuotas','TNA','TEA','TEM','CFT','CFTEA',
      'DELACROIX','FECHA','LIMITE','VTO.','CIERRE','VENCIMIENTO',
      'PROXIMO','PAGO MIN','LIMITES','40 OFF','TRANSFERENCIA DEUDA'
    ];

    // Líneas de impuestos/comisiones → van a Otros/Impuesto Tarjeta
    const IMPUESTO_KEYWORDS = [
      'INTERESES FINANCIACION','INTERESES PUNIT','PUNIT. PAG','PUNIT.PAG',
      'DB IVA','IIBB PERCEP','IVA RG','DB.RG','COMISION PAQUETE','COMISION','INTERES'
    ];

    // Regex para parsear línea de transacción del ICBC:
    // DD.MM.AA [COMPROBANTE] DESCRIPCION [C.NN/NN] PESOS[-] [DOLARES]
    const txRegex = /^(\d{2}\.\d{2}\.\d{2})\s+(\S+\*?)?\s*(.+?)\s+([\d.,]+)-?\s*$/;

    // Líneas que son impuestos/comisiones → van a otros/Impuesto Tarjeta
    const IMPUESTO_KEYS = [
      'INTERESES FINANCIACION','PUNIT','DB IVA','IIBB PERCEP',
      'IVA RG','DB.RG','COMISION PAQUETE','COMISION',
    ];

    for (const line of lines) {
      const lineUp = line.toUpperCase();
      const skip = SKIP_PREFIXES.some(p => lineUp.startsWith(p.toUpperCase()));
      if (skip) continue;

      // Detectar si es una línea de impuesto/comisión (no empieza con fecha pero tiene monto)
      const esImpuesto = IMPUESTO_KEYS.some(k => lineUp.includes(k));
      if (esImpuesto) {
        // Extraer monto — buscar número con formato argentino al final
        const montoMatch = line.match(/([\d.]+,\d{2})\s*$/);
        if (montoMatch) {
          const monto = parseFloat(montoMatch[1].replace(/\./g,'').replace(',','.'));
          if (monto > 0) {
            // Buscar fecha en la línea o usar la fecha del último item procesado
            const fechaMatch = line.match(/(\d{2}\.\d{2}\.\d{2})/);
            const fecha = fechaMatch
              ? `20${fechaMatch[1].split('.')[2]}-${fechaMatch[1].split('.')[1]}-${fechaMatch[1].split('.')[0]}`
              : (results.length ? results[results.length-1].fecha : new Date().toISOString().slice(0,10));
            results.push({
              _idx: results.length, fecha,
              desc: line.replace(/[\d.,]+\s*$/, '').trim().slice(0, 80),
              ars: monto, usd: 0, esRevision: false, catExcel: '',
              category: 'otros', subcat: 'Impuesto Tarjeta',
              mapped: true, medio: medioNombre, incluir: true,
            });
          }
        }
        continue;
      }

      const match = line.match(/^(\d{2}\.\d{2}\.\d{2})\s+(\d{6}[\w*]*)?\s*(.+?)\s+([\d]{1,3}(?:\.[\d]{3})*,\d{2})(-?)\s*([\d]{1,3}(?:\.[\d]{3})*,\d{2})?(-?)?\s*$/);
      if (!match) continue;

      const [, fechaRaw, , detalle, montoPesos, signoP, montoDolares, signoD] = match;
      const [dd, mm, aa] = fechaRaw.split('.');
      const fecha = `20${aa}-${mm}-${dd}`;

      const rawPesos = parseFloat(montoPesos.replace(/\./g,'').replace(',','.')) || 0;
      const rawUSD = montoDolares ? parseFloat(montoDolares.replace(/\./g,'').replace(',','.')) : 0;

      // Gasto en USD puro (pesos = USD) → viene convertido en el próximo resumen, ignorar
      if (rawUSD > 0 && Math.abs(rawPesos - rawUSD) < 0.01) continue;

      const esRevision = signoP === '-' || detalle.includes('DEV') || detalle.includes('DESCUENTO') || detalle.includes('40 OFF');
      const ars = esRevision ? -rawPesos : rawPesos;

      // Extraer info de cuotas: "C.04/06" → "Cuota 4/6"
      const cuotaMatch = detalle.match(/C\.(\d+)\/(\d+)/);
      const cuotaInfo = cuotaMatch ? ` [Cuota ${cuotaMatch[1]}/${cuotaMatch[2]}]` : '';
      const descLimpia = detalle.replace(/C\.\d+\/\d+/,'').replace(/\s+/g,' ').trim();

      // Mapeo por palabras clave del detalle
      const mapped = mapearPorDetalle(descLimpia);

      results.push({
        _idx: results.length,
        fecha,
        desc: descLimpia + cuotaInfo,
        ars,
        usd: rawUSD || 0,
        esRevision,
        catExcel: '',
        category: esRevision ? 'otros' : (mapped?.category || ''),
        subcat: esRevision ? 'Otros' : (mapped?.subcat || ''),
        mapped: esRevision ? true : !!mapped,
        medio: medioNombre,
        incluir: true,
      });
    }
    return results;
  };

  // Mapeo por palabras clave del detalle (para PDF donde no hay columna Categoria)
  const mapearPorDetalle = (desc) => {
    const d = desc.toUpperCase();
    if (d.includes('PEDIDOSYA') || d.includes('RAPPI') || d.includes('CARREFOUR') || d.includes('MARKET') || d.includes('EXTRA') || d.includes('FREDDO') || d.includes('LUCCIANO') || d.includes('CONFITERIA') || d.includes('ENTREBOLLOS') || d.includes('SATIATA') || d.includes('GRANJA') || d.includes('RAPANUI') || d.includes('PANADER') || d.includes('PIZZ')) return { category:'hogar', subcat:'Comida' };
    if (d.includes('SHELLBOX') || d.includes('NAFTA') || d.includes('YPF') || d.includes('SHELL') || d.includes('AXION')) return { category:'autos', subcat:'Tiguan Nafta' };
    if (d.includes('AUBASA') || d.includes('AUSA') || d.includes('AUSOL') || d.includes('CORREDORES') || d.includes('PEAJE')) return { category:'autos', subcat:'Peajes' };
    if (d.includes('BBVA SEGURO') || d.includes('SEGURO')) return { category:'hogar', subcat:'Seguro Hogar' };
    if (d.includes('APPLE') || d.includes('GOOGLE') || d.includes('YOUTUBE') || d.includes('NETFLIX') || d.includes('SPOTIFY') || d.includes('DISNEY') || d.includes('HBO')) return { category:'hogar', subcat:'Nube' };
    if (d.includes('MATERCELL')) return { category:'hogar', subcat:'Matercell' };
    if (d.includes('MOVISTAR') || d.includes('CLARO') || d.includes('PERSONAL')) return { category:'hogar', subcat:'Movistar' };
    if (d.includes('NATURGY') || d.includes('EDESUR') || d.includes('EDENOR') || d.includes('METROGAS')) return { category:'hogar', subcat:'Gas' };
    if (d.includes('ARBA') || d.includes('MUNICIPAL') || d.includes('RENTAS') || d.includes('AGIP')) return { category:'hogar', subcat:'Impuesto Municipal' };
    if (d.includes('MISHKA') || d.includes('KINDERLAND') || d.includes('WHITEBUTTERFL') || d.includes('BOKENPATIO')) return { category:'hijos', subcat:'Otros' };
    if (d.includes('GIRO DIDACTICO') || d.includes('LIBRERIAS') || d.includes('LIBRER')) return { category:'hijos', subcat:'Otros' };
    if (d.includes('CUORE') || d.includes('BABY') || d.includes('SOFIGLOBOS')) return { category:'hijos', subcat:'Otros' };
    if (d.includes('RIP CURL') || d.includes('INDUMENT') || d.includes('ROPA') || d.includes('COLOMBRARO') || d.includes('MELI') || d.includes('MERCADOLIBRE')) return { category:'otros', subcat:'Compras Ropa' };
    if (d.includes('CUOTA SOCIAL') || d.includes('CLUB') || d.includes('RIVER') || d.includes('ZENTRA') || d.includes('PROVEED')) return { category:'hijos', subcat:'Club Santa Barbara' };
    return null;
  };

  const handleFile = async (e) => {
    const f = e.target.files[0];
    if (!f || !cuentaId) { setMsg("Primero seleccioná la tarjeta."); return; }
    setMsg("Procesando...");
    const cuentaSel = cuentas.find(c => String(c.id) === String(cuentaId));
    const medioNombre = cuentaSel?.nombre || "VISA";

    try {
      const isPDF = f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf';

      if (isPDF) {
        const buf = await f.arrayBuffer();
        const pdfjsLib = await import("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.min.mjs");
        pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.2.67/pdf.worker.min.mjs";
        const pdf = await pdfjsLib.getDocument({ data: buf }).promise;

        // Recolectar todos los items de todas las páginas con su posición
        let allItems = [];
        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const vp = page.getViewport({ scale: 1 });
          const content = await page.getTextContent();
          // Normalizar Y: en PDF Y crece hacia arriba, lo invertimos por página
          content.items.forEach(item => {
            allItems.push({
              x: Math.round(item.transform[4]),
              y: Math.round(vp.height - item.transform[5]), // Y desde arriba
              str: item.str.trim(),
              page: i,
            });
          });
        }

        // Agrupar items en filas usando tolerancia de ±4px en Y
        allItems.sort((a, b) => a.page !== b.page ? a.page - b.page : a.y !== b.y ? a.y - b.y : a.x - b.x);
        const rows = [];
        let currentRow = [];
        let currentY = null;
        let currentPage = null;
        for (const item of allItems) {
          if (!item.str) continue;
          if (currentY === null || (item.page === currentPage && Math.abs(item.y - currentY) <= 4)) {
            currentRow.push(item);
            currentY = item.y;
            currentPage = item.page;
          } else {
            if (currentRow.length) rows.push(currentRow.sort((a,b) => a.x - b.x));
            currentRow = [item];
            currentY = item.y;
            currentPage = item.page;
          }
        }
        if (currentRow.length) rows.push(currentRow.sort((a,b) => a.x - b.x));

        // Convertir cada fila a texto y parsear
        // En el resumen ICBC las columnas son aproximadamente:
        // FECHA(x<80) | COMPROBANTE(x<180) | DETALLE(x<420) | PESOS(x<520) | DOLARES(x>520)
        // Unimos todo como texto por fila y dejamos que parsePDFText lo interprete
        const fullText = rows
          .map(row => row.map(i => i.str).join(' '))
          .filter(line => line.trim())
          .join('\n');

        // pdf.js a veces duplica líneas — limpiar antes de parsear
        const cleanText = fullText.split('\n').map(line => {
          // Detectar línea duplicada: "DD.MM.DD DD.MM.DD ..." → tomar la primera mitad
          const dateMatch = line.match(/^(\d{2}\.\d{2}\.\d{2}\s+.+?)\s+\1\s*$/);
          if (dateMatch) return dateMatch[1];
          // Detectar duplicación parcial por columnas: misma fecha repetida al inicio
          const doubleDateMatch = line.match(/^(\d{2}\.\d{2}\.\d{2})\s+\1\s+(.+?)\s+\2\s+([\d.,]+(?:-)?)\s+\3\s*$/);
          if (doubleDateMatch) return `${doubleDateMatch[1]} ${doubleDateMatch[2]} ${doubleDateMatch[3]}`;
          // Caso más común: "DD.MM.AA XXX* DESC DESC MONTO MONTO" → quitar segunda mitad
          const halfLen = Math.floor(line.length / 2);
          const firstHalf = line.slice(0, halfLen).trim();
          const secondHalf = line.slice(halfLen).trim();
          if (firstHalf && secondHalf && secondHalf.startsWith(firstHalf.slice(0, 10))) {
            return firstHalf;
          }
          return line;
        }).join('\n');

        const parsed = parsePDFText(cleanText, medioNombre);
        console.log('=== CLEAN TEXT (primeras líneas) ===\n', cleanText.slice(0, 2000));
        console.log('=== PARSED ROWS ===', parsed.length);
        if (!parsed.length) { setMsg("No se encontraron transacciones en el PDF. Verificá el formato."); return; }
        setRows(parsed);
        setStep("preview");
        setMsg("");

      } else {
        // Excel — lógica original
        const buf = await f.arrayBuffer();
        const XLSX = await import("https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs");
        const wb = XLSX.read(buf, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const data = XLSX.utils.sheet_to_json(ws, { defval: "" });

        const parsed = data.map((r, i) => {
          const fecha = excelSerialToISO(r["Fecha"]) || String(r["Fecha"]);
          const desc = r["Descripcion"] || r["Descripción"] || "";
          const ars = parseFloat(r["ARS"]) || 0;
          const catExcel = r["Categoria"] || r["Categoría"] || "";
          const mapped = CATEGORIA_MAP[catExcel];
          const tipo = r["Tipo"] || "";
          const esRevision = tipo.toLowerCase().includes("reversion") || tipo.toLowerCase().includes("crédito") || ars < 0;
          const cuotaMatch = desc.match(/C\.(\d+)\/(\d+)/);
          const cuotaInfo = cuotaMatch ? ` [Cuota ${cuotaMatch[1]}/${cuotaMatch[2]}]` : '';
          const descFinal = desc.replace(/C\.\d+\/\d+/,'').trim() + cuotaInfo;
          return {
            _idx: i, fecha, desc: descFinal,
            ars: esRevision ? -Math.abs(ars) : Math.abs(ars),
            usd: 0,
            esRevision, catExcel,
            category: esRevision ? "otros" : (mapped?.category || ""),
            subcat: esRevision ? "Otros" : (mapped?.subcat || ""),
            mapped: esRevision ? true : !!mapped,
            medio: medioNombre, incluir: true,
          };
        }).filter(r => r.ars !== 0);
        setRows(parsed);
        setStep("preview");
        setMsg("");
      }
    } catch (err) {
      setMsg("Error procesando el archivo: " + err.message);
      console.error(err);
    }
    e.target.value = "";
  };

  const handleImport = async () => {
    setStep("importing");
    const toInsert = rows
      .filter(r => r.incluir && r.category && r.subcat && r.fecha)
      .map(r => ({
        category: r.category,
        subcat: r.subcat,
        amount: r.ars, // puede ser negativo si es reversión
        moneda: "ARS",
        date: r.fecha,
        descripcion: r.desc,
        medio: r.medio,
        pagado: false,
        recurring: false,
        file_name: "",
      }));
    if (!toInsert.length) { setMsg("No hay filas válidas para importar."); setStep("preview"); return; }

    // Detectar rango de fechas del resumen
    const fechas = toInsert.map(r => r.date).filter(Boolean).sort();
    const fechaMin = fechas[0];
    const fechaMax = fechas[fechas.length - 1];
    const medioNombre = toInsert[0].medio;

    // Verificar si ya existen gastos de esta tarjeta en ese período
    const { data: existing } = await supabase
      .from("gastos")
      .select("id")
      .eq("medio", medioNombre)
      .gte("date", fechaMin)
      .lte("date", fechaMax);

    if (existing?.length > 0) {
      const confirmar = confirm(
        `Ya hay ${existing.length} gastos de "${medioNombre}" entre ${fechaMin} y ${fechaMax}.\n\n¿Querés reemplazarlos con este nuevo resumen?\n\nAceptar = borrar los anteriores e importar los nuevos\nCancelar = solo importar (pueden quedar duplicados)`
      );
      if (confirmar) {
        const ids = existing.map(e => e.id);
        await supabase.from("gastos").delete().in("id", ids);
      }
    }

    const { error } = await supabase.from("gastos").insert(toInsert);
    if (error) { setMsg("Error al importar: " + error.message); setStep("preview"); return; }
    setMsg(`✓ ${toInsert.length} transacciones importadas`);
    setStep("done");
    setTimeout(onDone, 1500);
  };

  const sinMapear = rows.filter(r => r.incluir && !r.mapped).length;
  const total = rows.filter(r => r.incluir).length;

  return (
    <div style={{ background:"#fff", border:"1px solid #d85a3044", borderRadius:12, padding:"1.25rem", marginBottom:"1.25rem" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:"1rem" }}>
        <h4 style={{ margin:0, fontSize:15, fontWeight:500, color:"#d85a30" }}>💳 Importar resumen de tarjeta</h4>
        <button onClick={onDone} style={{ background:"none", border:"none", fontSize:18, cursor:"pointer", color:"#999" }}>✕</button>
      </div>

      {step === "upload" && (
        <div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12, marginBottom:12 }}>
            <div><label style={{ fontSize:12, color:"#666", display:"block", marginBottom:4 }}>Tarjeta que impacta</label>
              <select value={cuentaId} onChange={e=>setCuentaId(e.target.value)} style={{ width:"100%", padding:"7px 10px", borderRadius:8, border:"1px solid #ddd", fontSize:14, boxSizing:"border-box" }}>
                <option value="">— Seleccioná —</option>
                {tarjetas.map(c=><option key={c.id} value={c.id}>💳 {c.nombre}</option>)}
                {tarjetas.length===0&&<option disabled>No tenés tarjetas creadas en Ahorros</option>}
              </select>
            </div>
            <div style={{ display:"flex", alignItems:"flex-end" }}>
              <div style={{ width:"100%" }}>
                <label style={{ fontSize:12, color:"#666", display:"block", marginBottom:4 }}>Archivo Excel (.xlsx) o PDF</label>
                <input ref={fileRef} type="file" accept=".xlsx,.xls,.pdf" onChange={handleFile} style={{ display:"none" }}/>
                <button onClick={()=>{ if(!cuentaId){setMsg("Primero seleccioná la tarjeta.");return;} fileRef.current.click(); }} style={{ width:"100%", padding:"7px 10px", background:"#d85a30", color:"#fff", border:"none", borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:500 }}>
                  📎 Subir Excel o PDF
                </button>
              </div>
            </div>
          </div>
          {msg && <p style={{ fontSize:12, color:"#e24b4a", margin:0 }}>{msg}</p>}
          <p style={{ fontSize:11, color:"#999", margin:"8px 0 0" }}>
            Aceptamos PDF del resumen ICBC/VISA o Excel con columnas Fecha, Descripcion, ARS, Tipo, Categoria.
          </p>

          {/* ── Resúmenes existentes ── */}
          {cuentaId && (
            <div style={{ marginTop:16, borderTop:"1px solid #f0f0f0", paddingTop:12 }}>
              <p style={{ fontSize:12, fontWeight:500, color:"#666", margin:"0 0 8px" }}>
                Resúmenes cargados para esta tarjeta:
              </p>
              {loadingResumenes
                ? <p style={{ fontSize:12, color:"#999" }}>Cargando...</p>
                : resumenes.length === 0
                  ? <p style={{ fontSize:12, color:"#bbb" }}>No hay resúmenes cargados.</p>
                  : <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
                    {resumenes.map(r => (
                      <div key={r.mes} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 12px", background:"#f9f9f9", borderRadius:8, border:"1px solid #eee" }}>
                        <div>
                          <span style={{ fontSize:13, fontWeight:500 }}>{r.mes}</span>
                          <span style={{ fontSize:11, color:"#999", marginLeft:10 }}>{r.count} transacciones · {fmtARS(r.totalARS)}</span>
                        </div>
                        <button
                          onClick={() => handleEliminarResumen(r.mes, r.ids)}
                          style={{ fontSize:12, padding:"3px 10px", background:"none", border:"1px solid #e24b4a44", borderRadius:6, cursor:"pointer", color:"#e24b4a" }}
                        >🗑 Eliminar</button>
                      </div>
                    ))}
                  </div>
              }
            </div>
          )}
        </div>
      )}

      {step === "preview" && (
        <div>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10, flexWrap:"wrap", gap:8 }}>
            <div style={{ fontSize:13 }}>
              <strong>{total}</strong> transacciones · 
              {sinMapear > 0
                ? <span style={{ color:"#e24b4a", marginLeft:4 }}>⚠️ {sinMapear} sin categoría</span>
                : <span style={{ color:"#1d9e75", marginLeft:4 }}>✓ Todas mapeadas</span>
              }
              {rows.filter(r=>r.esRevision).length > 0 && (
                <span style={{ color:"#1d9e75", marginLeft:8 }}>· {rows.filter(r=>r.esRevision).length} reversiones incluidas (restan de la deuda) ↩</span>
              )}
            </div>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={()=>setStep("upload")} style={{ fontSize:12, padding:"5px 12px", background:"none", border:"1px solid #ddd", borderRadius:8, cursor:"pointer", color:"#666" }}>← Volver</button>
              <button onClick={handleImport} disabled={sinMapear>0&&rows.some(r=>r.incluir&&!r.category)} style={{ fontSize:13, padding:"6px 16px", background:"#d85a30", color:"#fff", border:"none", borderRadius:8, cursor:"pointer", fontWeight:500 }}>
                Importar {total} transacciones →
              </button>
            </div>
          </div>
          <div style={{ maxHeight:400, overflowY:"auto", border:"1px solid #eee", borderRadius:8 }}>
            <table style={{ width:"100%", borderCollapse:"collapse", fontSize:12 }}>
              <thead style={{ position:"sticky", top:0, background:"#f9f9f9" }}>
                <tr>
                  <th style={{ padding:"6px 8px", textAlign:"left", color:"#666", fontWeight:500, borderBottom:"1px solid #eee" }}>Incluir</th>
                  <th style={{ padding:"6px 8px", textAlign:"left", color:"#666", fontWeight:500, borderBottom:"1px solid #eee" }}>Fecha</th>
                  <th style={{ padding:"6px 8px", textAlign:"left", color:"#666", fontWeight:500, borderBottom:"1px solid #eee" }}>Descripción</th>
                  <th style={{ padding:"6px 8px", textAlign:"right", color:"#666", fontWeight:500, borderBottom:"1px solid #eee" }}>ARS</th>
                  <th style={{ padding:"6px 8px", textAlign:"left", color:"#666", fontWeight:500, borderBottom:"1px solid #eee" }}>Cat. Excel</th>
                  <th style={{ padding:"6px 8px", textAlign:"left", color:"#666", fontWeight:500, borderBottom:"1px solid #eee", minWidth:200 }}>Foco › Subcategoría</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r._idx} style={{ borderBottom:"1px solid #f5f5f5", background: !r.mapped && r.incluir ? "#fff8f0" : r.esRevision ? "#f0faf5" : "#fff" }}>
                    <td style={{ padding:"5px 8px", textAlign:"center" }}>
                      <input type="checkbox" checked={r.incluir} onChange={e=>setRows(p=>p.map((x,j)=>j===i?{...x,incluir:e.target.checked}:x))}/>
                    </td>
                    <td style={{ padding:"5px 8px", whiteSpace:"nowrap", color:"#666" }}>{r.fecha}</td>
                    <td style={{ padding:"5px 8px", maxWidth:200, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }} title={r.desc}>{r.desc}</td>
                    <td style={{ padding:"5px 8px", textAlign:"right", fontWeight:500, color: r.esRevision?"#1d9e75":"#1a1a1a" }}>
                      {r.esRevision&&<span style={{ fontSize:10, color:"#1d9e75", marginRight:3 }}>↩</span>}
                      {fmtARS(Math.abs(r.ars))}
                    </td>
                    <td style={{ padding:"5px 8px", fontSize:11, color:"#888" }}>{r.catExcel}</td>
                    <td style={{ padding:"5px 8px" }}>
                      {r.incluir ? (
                        <select
                          value={`${r.category}|${r.subcat}`}
                          onChange={e=>{
                            const [cat,sub]=e.target.value.split("|");
                            setRows(p=>p.map((x,j)=>j===i?{...x,category:cat,subcat:sub,mapped:true}:x));
                          }}
                          style={{ width:"100%", padding:"3px 6px", borderRadius:6, border:`1px solid ${r.mapped?"#ddd":"#e24b4a"}`, fontSize:11, background: r.mapped?"#fff":"#fff0f0" }}
                        >
                          <option value="|">⚠️ Sin categoría — seleccioná</option>
                          {allSubcats.map(s=><option key={`${s.category}|${s.subcat}`} value={`${s.category}|${s.subcat}`}>{s.label}</option>)}
                        </select>
                      ) : <span style={{ color:"#ccc", fontSize:11 }}>—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {msg && <p style={{ fontSize:12, color:"#e24b4a", margin:"8px 0 0" }}>{msg}</p>}
        </div>
      )}

      {step === "importing" && <p style={{ textAlign:"center", color:"#d85a30", padding:"1rem" }}>⏳ Importando transacciones...</p>}
      {step === "done" && <p style={{ textAlign:"center", color:"#1d9e75", padding:"1rem", fontWeight:500 }}>{msg}</p>}
    </div>
  );
}

// ─── AHORROS TAB ─────────────────────────────────────────────────────────────────

function AhorrosTab({ expenses, categories }) {
  const [cuentas, setCuentas] = useState([]);
  const [movimientos, setMovimientos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showFormCuenta, setShowFormCuenta] = useState(false);
  const [showFormMov, setShowFormMov] = useState(false);
  const [editCuenta, setEditCuenta] = useState(null);
  const [editMov, setEditMov] = useState(null);
  const [showImporter, setShowImporter] = useState(false);

  const defaultCuenta = { nombre:"", tipo:"liquida", moneda:"USD", saldo_inicial:0, orden:0 };
  const defaultMov = () => ({
    fecha: new Date().toISOString().slice(0,10),
    descripcion: "",
    cuenta_origen_id: "",
    cuenta_destino_id: "",
    monto: "",
    moneda: "USD",
    tipo_cambio: getLatestBlueRate() || "",
    tipo_mov: "transferencia",
  });

  const [formCuenta, setFormCuenta] = useState(defaultCuenta);
  const [formMov, setFormMov] = useState(defaultMov());

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    const [{ data: c }, { data: m }] = await Promise.all([
      supabase.from("cuentas").select("*").order("orden"),
      supabase.from("movimientos").select("*").order("fecha", { ascending: false }),
    ]);
    if (c) setCuentas(c);
    if (m) setMovimientos(m);
    setLoading(false);
  };

  // ── Saldo actual de cada cuenta ──────────────────────────────────
  function getSaldo(cuentaId) {
    const cuenta = cuentas.find(c => c.id === cuentaId);
    if (!cuenta) return 0;
    if (cuenta.tipo === "tarjeta") {
      // Deuda = gastos con ese medio (en USD al último blue) menos pagos en movimientos
      const latestRate = getLatestBlueRate() || 1;
      const gastosUSD = (expenses || [])
        .filter(e => e.medio === cuenta.nombre)
        .reduce((s, e) => s + toUSD(e.amount, e.moneda || "ARS", e.date), 0);
      const pagosUSD = movimientos
        .filter(m => m.cuenta_destino_id === cuentaId)
        .reduce((s, m) => s + Number(m.monto_usd), 0);
      // negativo = deuda pendiente
      return pagosUSD - gastosUSD;
    }
    // Cuenta líquida: saldo inicial ± movimientos
    let saldo = Number(cuenta.saldo_inicial) || 0;
    movimientos.forEach(m => {
      if (m.cuenta_origen_id === cuentaId) saldo -= Number(m.monto_usd);
      if (m.cuenta_destino_id === cuentaId) saldo += Number(m.monto_usd);
    });
    return saldo;
  }

  // ── Deuda de tarjeta = gastos ARS no saldados por pagos en movimientos ──
  // La deuda se muestra en ARS (suma exacta de gastos) y en USD al último blue
  function getDeudaTarjeta(nombreTarjeta) {
    // Buscar la cuenta de esta tarjeta
    const cuenta = cuentas.find(c => c.nombre === nombreTarjeta && c.tipo === "tarjeta");
    if (!cuenta) return { ars: 0, usd: 0 };
    // El saldo de la cuenta ya refleja los pagos registrados como movimientos
    // saldo negativo = deuda; saldo positivo = a favor
    const saldoUSD = getSaldo(cuenta.id);
    const latestRate = getLatestBlueRate() || 1;
    // Deuda en ARS al último blue
    return { usd: saldoUSD, ars: saldoUSD * latestRate };
  }

  const patrimonioTotal = cuentas
    .filter(c => c.tipo === "liquida")
    .reduce((s, c) => s + getSaldo(c.id), 0);

  // ── Guardar cuenta ───────────────────────────────────────────────
  const handleSaveCuenta = async () => {
    const montoRaw = parseFloat(formCuenta.saldo_inicial) || 0;
    // Si ingresó en ARS, convertir a USD al blue actual para guardar siempre en USD
    const saldo_usd = formCuenta.moneda === "ARS"
      ? montoRaw / (getLatestBlueRate() || 1)
      : montoRaw;
    const row = { nombre: formCuenta.nombre, tipo: formCuenta.tipo, moneda: "USD", saldo_inicial: saldo_usd, orden: parseInt(formCuenta.orden) || 0 };
    if (editCuenta) {
      await supabase.from("cuentas").update(row).eq("id", editCuenta.id);
    } else {
      await supabase.from("cuentas").insert(row);
    }
    setShowFormCuenta(false); setEditCuenta(null); setFormCuenta(defaultCuenta);
    loadAll();
  };

  const handleDeleteCuenta = async (id) => {
    if (!confirm("¿Eliminar esta cuenta? También se eliminarán sus movimientos.")) return;
    await supabase.from("movimientos").delete().or(`cuenta_origen_id.eq.${id},cuenta_destino_id.eq.${id}`);
    await supabase.from("cuentas").delete().eq("id", id);
    loadAll();
  };

  // ── Guardar movimiento ───────────────────────────────────────────
  const handleSaveMov = async () => {
    const f = formMov;
    if (!f.monto || !f.fecha || !f.cuenta_origen_id) return;
    const monto = parseFloat(f.monto);
    let tc = parseFloat(f.tipo_cambio) || getBlueRate(f.fecha) || getLatestBlueRate() || 1;
    const monto_usd = f.moneda === "USD" ? monto : monto / tc;
    const row = {
      fecha: f.fecha,
      descripcion: f.descripcion,
      cuenta_origen_id: parseInt(f.cuenta_origen_id),
      cuenta_destino_id: f.cuenta_destino_id ? parseInt(f.cuenta_destino_id) : null,
      monto,
      moneda: f.moneda,
      tipo_cambio: f.moneda === "ARS" ? tc : null,
      monto_usd,
    };
    if (editMov) {
      await supabase.from("movimientos").update(row).eq("id", editMov.id);
    } else {
      await supabase.from("movimientos").insert(row);
    }
    setShowFormMov(false); setEditMov(null); setFormMov(defaultMov());
    loadAll();
  };

  const handleDeleteMov = async (id) => {
    await supabase.from("movimientos").delete().eq("id", id);
    loadAll();
  };

  const tipoColor = { liquida: "#3266ad", tarjeta: "#d85a30" };
  const tipoIcon = { liquida: "🏦", tarjeta: "💳" };

  // ── Cuando cambia la fecha en el form mov, actualiza TC automático
  const handleFechaMov = (fecha) => {
    const tc = getBlueRate(fecha) || getLatestBlueRate() || "";
    setFormMov(p => ({ ...p, fecha, tipo_cambio: p.moneda === "ARS" ? tc : p.tipo_cambio }));
  };

  const handleMonedaMov = (moneda) => {
    const tc = moneda === "ARS" ? (getBlueRate(formMov.fecha) || getLatestBlueRate() || "") : "";
    setFormMov(p => ({ ...p, moneda, tipo_cambio: tc }));
  };

  const montoUSDPreview = () => {
    const m = parseFloat(formMov.monto);
    const tc = parseFloat(formMov.tipo_cambio);
    if (!m) return null;
    if (formMov.moneda === "USD") return m;
    if (!tc) return null;
    return m / tc;
  };

  if (loading) return <p style={{ textAlign:"center", color:"#999", fontSize:14, padding:"2rem" }}>Cargando...</p>;

  return (
    <div>
      {/* ── Patrimonio total ── */}
      <div style={{ background:"linear-gradient(135deg,#3266ad,#1a4a8a)", borderRadius:16, padding:"1.5rem", marginBottom:"1.25rem", color:"#fff" }}>
        <p style={{ fontSize:13, margin:"0 0 4px", opacity:0.8 }}>Patrimonio neto (cuentas líquidas)</p>
        <p style={{ fontSize:36, fontWeight:700, margin:"0 0 4px", letterSpacing:-1 }}>{fmtUSD(patrimonioTotal)}</p>
        <p style={{ fontSize:12, margin:0, opacity:0.6 }}>Saldo inicial + movimientos registrados</p>
      </div>

      {/* ── Cards de cuentas ── */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10 }}>
        <h3 style={{ margin:0, fontSize:15, fontWeight:500 }}>Cuentas</h3>
        <button onClick={() => { setFormCuenta(defaultCuenta); setEditCuenta(null); setShowFormCuenta(true); }} style={{ fontSize:13, padding:"5px 14px", background:"#3266ad", color:"#fff", border:"none", borderRadius:8, cursor:"pointer", fontWeight:500 }}>+ Nueva cuenta</button>
      </div>

      <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))", gap:10, marginBottom:"1.5rem" }}>
        {cuentas.map(c => {
          const saldo = getSaldo(c.id);
          const latestRate = getLatestBlueRate();
          // Para tarjetas: saldo negativo = deuda, positivo = a favor
          // Para líquidas: saldo positivo = disponible
          const esTarjeta = c.tipo === "tarjeta";
          const tieneDeuda = esTarjeta && saldo < 0;
          const deudaUSD = Math.abs(saldo);
          const deudaARS = latestRate ? deudaUSD * latestRate : null;
          return (
            <div key={c.id} style={{ background:"#fff", border:`1px solid ${tipoColor[c.tipo]}33`, borderTop:`3px solid ${tipoColor[c.tipo]}`, borderRadius:12, padding:"1rem", position:"relative" }}>
              <div style={{ fontSize:11, color:tipoColor[c.tipo], fontWeight:500, marginBottom:4, display:"flex", alignItems:"center", gap:4 }}>
                {tipoIcon[c.tipo]} {esTarjeta ? "Tarjeta" : "Cuenta"}
              </div>
              <div style={{ fontSize:14, fontWeight:600, marginBottom:6, color:"#1a1a1a" }}>{c.nombre}</div>
              {esTarjeta ? (
                tieneDeuda ? (
                  <>
                    <div style={{ fontSize:20, fontWeight:700, color:"#e24b4a" }}>-{fmtUSD(deudaUSD)}</div>
                    {deudaARS && <div style={{ fontSize:12, color:"#e24b4a", marginTop:2 }}>
                      {fmtARS(deudaARS)}
                      <span style={{ fontSize:10, color:"#bbb", marginLeft:4 }}>blue {fmtARS(latestRate)}</span>
                    </div>}
                    <div style={{ fontSize:10, color:"#bbb", marginTop:4 }}>Gastos pendientes de pago</div>
                  </>
                ) : (
                  <>
                    <div style={{ fontSize:20, fontWeight:700, color:"#1d9e75" }}>{fmtUSD(saldo)}</div>
                    <div style={{ fontSize:11, color:"#1d9e75", marginTop:2 }}>Sin deuda</div>
                  </>
                )
              ) : (
                <>
                  <div style={{ fontSize:20, fontWeight:700, color: saldo >= 0 ? "#1d9e75" : "#e24b4a" }}>{fmtUSD(saldo)}</div>
                  {latestRate && <div style={{ fontSize:11, color:"#999", marginTop:2 }}>{fmtARS(saldo * latestRate)}</div>}
                </>
              )}
              <div style={{ display:"flex", gap:6, marginTop:10 }}>
                <button onClick={() => { setFormCuenta({ nombre:c.nombre, tipo:c.tipo, moneda:c.moneda, saldo_inicial:c.saldo_inicial, orden:c.orden }); setEditCuenta(c); setShowFormCuenta(true); }} style={{ fontSize:11, padding:"2px 10px", background:"none", border:"1px solid #ddd", borderRadius:6, cursor:"pointer", color:"#666" }}>Editar</button>
                <button onClick={() => handleDeleteCuenta(c.id)} style={{ fontSize:11, padding:"2px 8px", background:"none", border:"1px solid #ddd", borderRadius:6, cursor:"pointer", color:"#e24b4a" }}>✕</button>
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Form nueva cuenta ── */}
      {showFormCuenta && (
        <div style={{ background:"#fff", border:"1px solid #e0e0e0", borderRadius:12, padding:"1.25rem", marginBottom:"1.25rem" }}>
          <h4 style={{ margin:"0 0 1rem", fontSize:15, fontWeight:500 }}>{editCuenta ? "Editar cuenta" : "Nueva cuenta"}</h4>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <div><label style={{ fontSize:12, color:"#666", display:"block", marginBottom:4 }}>Nombre</label>
              <input value={formCuenta.nombre} onChange={e=>setFormCuenta(p=>({...p,nombre:e.target.value}))} placeholder="Ej: Cash Casa" style={{ width:"100%", padding:"7px 10px", borderRadius:8, border:"1px solid #ddd", fontSize:14, boxSizing:"border-box" }}/>
            </div>
            <div><label style={{ fontSize:12, color:"#666", display:"block", marginBottom:4 }}>Tipo</label>
              <select value={formCuenta.tipo} onChange={e=>setFormCuenta(p=>({...p,tipo:e.target.value}))} style={{ width:"100%", padding:"7px 10px", borderRadius:8, border:"1px solid #ddd", fontSize:14, boxSizing:"border-box" }}>
                <option value="liquida">🏦 Cuenta líquida</option>
                <option value="tarjeta">💳 Tarjeta de crédito</option>
              </select>
            </div>
            <div><label style={{ fontSize:12, color:"#666", display:"block", marginBottom:4 }}>Moneda del saldo inicial</label>
              <div style={{ display:"flex", gap:6 }}>
                {["USD","ARS"].map(m=>(
                  <button key={m} onClick={()=>setFormCuenta(p=>({...p,moneda:m}))} style={{ flex:1, padding:"7px", borderRadius:8, border:`1px solid ${formCuenta.moneda===m?"#3266ad":"#ddd"}`, background:formCuenta.moneda===m?"#f0f4ff":"#fff", color:formCuenta.moneda===m?"#3266ad":"#666", fontWeight:formCuenta.moneda===m?600:400, cursor:"pointer", fontSize:14 }}>{m}</button>
                ))}
              </div>
            </div>
            <div><label style={{ fontSize:12, color:"#666", display:"block", marginBottom:4 }}>Saldo inicial ({formCuenta.moneda})</label>
              <input type="number" value={formCuenta.saldo_inicial} onChange={e=>setFormCuenta(p=>({...p,saldo_inicial:e.target.value}))} placeholder="0" style={{ width:"100%", padding:"7px 10px", borderRadius:8, border:"1px solid #ddd", fontSize:14, boxSizing:"border-box" }}/>
              {formCuenta.moneda==="ARS" && formCuenta.saldo_inicial && (
                <p style={{ fontSize:11, color:"#999", margin:"3px 0 0" }}>≈ {fmtUSD((parseFloat(formCuenta.saldo_inicial)||0) / (getLatestBlueRate()||1))} al blue actual</p>
              )}
            </div>
            <div><label style={{ fontSize:12, color:"#666", display:"block", marginBottom:4 }}>Orden</label>
              <input type="number" value={formCuenta.orden} onChange={e=>setFormCuenta(p=>({...p,orden:e.target.value}))} placeholder="0" style={{ width:"100%", padding:"7px 10px", borderRadius:8, border:"1px solid #ddd", fontSize:14, boxSizing:"border-box" }}/>
            </div>
          </div>
          <div style={{ display:"flex", gap:8, marginTop:"1rem" }}>
            <button onClick={handleSaveCuenta} style={{ padding:"8px 20px", background:"#3266ad", color:"#fff", border:"none", borderRadius:8, cursor:"pointer", fontSize:14, fontWeight:500 }}>Guardar</button>
            <button onClick={() => { setShowFormCuenta(false); setEditCuenta(null); }} style={{ padding:"8px 16px", background:"none", border:"1px solid #ddd", borderRadius:8, cursor:"pointer", fontSize:14, color:"#666" }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* ── Movimientos ── */}
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:10, flexWrap:"wrap", gap:8 }}>
        <h3 style={{ margin:0, fontSize:15, fontWeight:500 }}>Movimientos</h3>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          <button onClick={() => exportCSV([
            ["Fecha","Descripcion","Origen","Destino","Monto","Moneda","TC","Monto USD"],
            ...movimientos.map(m=>[ m.fecha, m.descripcion||"", cuentas.find(c=>c.id===m.cuenta_origen_id)?.nombre||"externo", cuentas.find(c=>c.id===m.cuenta_destino_id)?.nombre||"externo", m.monto, m.moneda||"USD", m.tipo_cambio||"", m.monto_usd ])
          ],"movimientos")} style={{ fontSize:12, padding:"5px 12px", background:"#f5f5f5", border:"1px solid #ddd", borderRadius:8, cursor:"pointer", color:"#666" }}>↓ Export movimientos</button>
          <button onClick={() => setShowImporter(p=>!p)} style={{ fontSize:13, padding:"5px 14px", background:"#d85a30", color:"#fff", border:"none", borderRadius:8, cursor:"pointer", fontWeight:500 }}>💳 Subir resumen tarjeta</button>
          <button onClick={() => { setFormMov(defaultMov()); setEditMov(null); setShowFormMov(true); }} style={{ fontSize:13, padding:"5px 14px", background:"#1d9e75", color:"#fff", border:"none", borderRadius:8, cursor:"pointer", fontWeight:500 }}>+ Nuevo movimiento</button>
        </div>
      </div>

      {/* ── Importer de resumen de tarjeta ── */}
      {showImporter && (
        <TarjetaImporter
          cuentas={cuentas}
          categories={categories}
          onDone={() => { setShowImporter(false); loadAll(); }}
        />
      )}

      {/* ── Form nuevo movimiento ── */}
      {showFormMov && (
        <div style={{ background:"#fff", border:"1px solid #e0e0e0", borderRadius:12, padding:"1.25rem", marginBottom:"1.25rem" }}>
          <h4 style={{ margin:"0 0 1rem", fontSize:15, fontWeight:500 }}>{editMov ? "Editar movimiento" : "Nuevo movimiento"}</h4>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <div><label style={{ fontSize:12, color:"#666", display:"block", marginBottom:4 }}>Fecha</label>
              <input type="date" value={formMov.fecha} onChange={e=>handleFechaMov(e.target.value)} style={{ width:"100%", padding:"7px 10px", borderRadius:8, border:"1px solid #ddd", fontSize:14, boxSizing:"border-box" }}/>
            </div>
            <div><label style={{ fontSize:12, color:"#666", display:"block", marginBottom:4 }}>Tipo de movimiento</label>
              <select value={formMov.tipo_mov} onChange={e=>setFormMov(p=>({...p,tipo_mov:e.target.value,cuenta_destino_id:""}))} style={{ width:"100%", padding:"7px 10px", borderRadius:8, border:"1px solid #ddd", fontSize:14, boxSizing:"border-box" }}>
                <option value="transferencia">↔ Transferencia entre cuentas</option>
                <option value="gasto">↑ Gasto / salida de dinero</option>
                <option value="ingreso_externo">↓ Ingreso externo</option>
              </select>
            </div>
            <div><label style={{ fontSize:12, color:"#666", display:"block", marginBottom:4 }}>
              {formMov.tipo_mov === "ingreso_externo" ? "Cuenta destino" : "Cuenta origen (sale de acá)"}
            </label>
              <select value={formMov.cuenta_origen_id} onChange={e=>setFormMov(p=>({...p,cuenta_origen_id:e.target.value}))} style={{ width:"100%", padding:"7px 10px", borderRadius:8, border:"1px solid #ddd", fontSize:14, boxSizing:"border-box" }}>
                <option value="">— Seleccioná —</option>
                {cuentas.map(c=><option key={c.id} value={c.id}>{tipoIcon[c.tipo]} {c.nombre} ({fmtUSD(getSaldo(c.id))})</option>)}
              </select>
            </div>
            {formMov.tipo_mov === "transferencia" && (
              <div><label style={{ fontSize:12, color:"#666", display:"block", marginBottom:4 }}>Cuenta destino (entra acá)</label>
                <select value={formMov.cuenta_destino_id} onChange={e=>setFormMov(p=>({...p,cuenta_destino_id:e.target.value}))} style={{ width:"100%", padding:"7px 10px", borderRadius:8, border:"1px solid #ddd", fontSize:14, boxSizing:"border-box" }}>
                  <option value="">— Seleccioná —</option>
                  {cuentas.filter(c=>String(c.id)!==String(formMov.cuenta_origen_id)).map(c=><option key={c.id} value={c.id}>{tipoIcon[c.tipo]} {c.nombre}</option>)}
                </select>
              </div>
            )}
            <div><label style={{ fontSize:12, color:"#666", display:"block", marginBottom:4 }}>Moneda</label>
              <div style={{ display:"flex", gap:6 }}>
                {["USD","ARS"].map(m=>(
                  <button key={m} onClick={()=>handleMonedaMov(m)} style={{ flex:1, padding:"7px", borderRadius:8, border:`1px solid ${formMov.moneda===m?"#3266ad":"#ddd"}`, background:formMov.moneda===m?"#f0f4ff":"#fff", color:formMov.moneda===m?"#3266ad":"#666", fontWeight:formMov.moneda===m?600:400, cursor:"pointer", fontSize:14 }}>{m}</button>
                ))}
              </div>
            </div>
            <div><label style={{ fontSize:12, color:"#666", display:"block", marginBottom:4 }}>Monto ({formMov.moneda})</label>
              <input type="number" value={formMov.monto} onChange={e=>setFormMov(p=>({...p,monto:e.target.value}))} placeholder="0" style={{ width:"100%", padding:"7px 10px", borderRadius:8, border:"1px solid #ddd", fontSize:14, boxSizing:"border-box" }}/>
            </div>
            {formMov.moneda === "ARS" && (
              <div><label style={{ fontSize:12, color:"#666", display:"block", marginBottom:4 }}>Tipo de cambio (editable)</label>
                <input type="number" value={formMov.tipo_cambio} onChange={e=>setFormMov(p=>({...p,tipo_cambio:e.target.value}))} placeholder="TC del día" style={{ width:"100%", padding:"7px 10px", borderRadius:8, border:"1px solid #3266ad", fontSize:14, boxSizing:"border-box", background:"#f0f4ff" }}/>
                {montoUSDPreview() !== null && <p style={{ fontSize:11, color:"#999", margin:"3px 0 0" }}>≈ {fmtUSD(montoUSDPreview())}</p>}
              </div>
            )}
            <div style={{ gridColumn:"1/-1" }}><label style={{ fontSize:12, color:"#666", display:"block", marginBottom:4 }}>Descripción</label>
              <input type="text" value={formMov.descripcion} onChange={e=>setFormMov(p=>({...p,descripcion:e.target.value}))} placeholder="Ej: Pago resumen VISA / Pago pintor / Transferencia DEEL→Citi" style={{ width:"100%", padding:"7px 10px", borderRadius:8, border:"1px solid #ddd", fontSize:14, boxSizing:"border-box" }}/>
            </div>
          </div>
          <div style={{ display:"flex", gap:8, marginTop:"1rem" }}>
            <button onClick={handleSaveMov} style={{ padding:"8px 20px", background:"#1d9e75", color:"#fff", border:"none", borderRadius:8, cursor:"pointer", fontSize:14, fontWeight:500 }}>Guardar</button>
            <button onClick={() => { setShowFormMov(false); setEditMov(null); }} style={{ padding:"8px 16px", background:"none", border:"1px solid #ddd", borderRadius:8, cursor:"pointer", fontSize:14, color:"#666" }}>Cancelar</button>
          </div>
        </div>
      )}

      {/* ── Historial de movimientos ── */}
      {movimientos.length === 0
        ? <div style={{ textAlign:"center", padding:"2rem", color:"#999", fontSize:14 }}>No hay movimientos registrados.</div>
        : <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
          {movimientos.map(m => {
            const origen = cuentas.find(c => c.id === m.cuenta_origen_id);
            const destino = cuentas.find(c => c.id === m.cuenta_destino_id);
            const esTransferencia = !!destino;
            const esIngreso = !origen;
            return (
              <div key={m.id} style={{ display:"flex", justifyContent:"space-between", alignItems:"center", background:"#fff", border:"1px solid #eee", borderLeft:`3px solid ${esTransferencia?"#3266ad":esIngreso?"#1d9e75":"#e24b4a"}`, borderRadius:8, padding:"10px 14px", gap:8 }}>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
                    <span style={{ fontSize:15 }}>{esTransferencia?"↔":esIngreso?"↓":"↑"}</span>
                    <span style={{ fontSize:13, fontWeight:500 }}>
                      {esTransferencia ? `${origen?.nombre} → ${destino?.nombre}` : esIngreso ? `Ingreso → ${cuentas.find(c=>c.id===m.cuenta_destino_id)?.nombre||"?"}` : `${origen?.nombre} → afuera`}
                    </span>
                    {m.moneda === "ARS" && m.tipo_cambio && (
                      <span style={{ fontSize:11, padding:"2px 7px", borderRadius:20, background:"#f0f4ff", color:"#3266ad" }}>TC {fmtARS(m.tipo_cambio)}</span>
                    )}
                  </div>
                  <div style={{ fontSize:11, color:"#999", marginTop:2 }}>{m.fecha}{m.descripcion ? ` · ${m.descripcion}` : ""}</div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:10, flexShrink:0 }}>
                  <div style={{ textAlign:"right" }}>
                    <div style={{ fontWeight:600, fontSize:14, color: esIngreso?"#1d9e75":esTransferencia?"#3266ad":"#e24b4a" }}>{fmtUSD(m.monto_usd)}</div>
                    {m.moneda === "ARS" && <div style={{ fontSize:11, color:"#aaa" }}>{fmtARS(m.monto)}</div>}
                  </div>
                  <button onClick={() => { setFormMov({ fecha:m.fecha, descripcion:m.descripcion||"", cuenta_origen_id:String(m.cuenta_origen_id||""), cuenta_destino_id:String(m.cuenta_destino_id||""), monto:String(m.monto), moneda:m.moneda||"USD", tipo_cambio:String(m.tipo_cambio||""), tipo_mov: m.cuenta_destino_id?"transferencia":"gasto" }); setEditMov(m); setShowFormMov(true); }} style={{ fontSize:12, padding:"3px 10px", background:"none", border:"1px solid #ddd", borderRadius:8, cursor:"pointer", color:"#666" }}>Editar</button>
                  <button onClick={() => handleDeleteMov(m.id)} style={{ fontSize:12, padding:"3px 8px", background:"none", border:"1px solid #ddd", borderRadius:8, cursor:"pointer", color:"#e24b4a" }}>✕</button>
                </div>
              </div>
            );
          })}
        </div>
      }
    </div>
  );
}
