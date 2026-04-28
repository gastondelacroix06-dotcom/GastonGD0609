import { useState, useEffect, useRef } from "react";
import React from "react";
import { supabase } from "./supabase.js";

// ─── CONSTANTES ────────────────────────────────────────────────────────────────

const DEFAULT_CATEGORIES = {
  hogar: { label:"Hogar", icon:"🏠", color:"#3266ad", subcats:["Luz","Gas","Agua","Internet","TV Streaming","Impuesto Municipal","Impuesto Provincial","Seguro Hogar","Vigilancia","Monitoreo de Puerta","Otros"] },
  autos: { label:"Autos", icon:"🚗", color:"#d85a30", subcats:["VW Polo - Seguro","VW Polo - Combustible","VW Polo - Mecánico","VW Polo - Service","VW Gol - Seguro","VW Gol - Combustible","VW Gol - Mecánico","VW Gol - Service"] },
  hijos: { label:"Hijos", icon:"🧑‍🧑‍🧒‍🧒", color:"#1d9e75", subcats:["Colegio","Actividades","Otros"] }
};

const DEFAULT_INCOME_CATEGORIES = ["Sueldo","Freelance / Honorarios","Alquiler cobrado","Dividendos","Venta de activos","Bono","Otros ingresos"];

// Medios de pago: la lista base, pero el usuario puede agregar más
const BASE_MEDIOS = ["Débito automático","Transferencia","Efectivo","VISA ICBC","VISA Santander","Amex Santander"];

const MONTHS_FULL = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
const TABS = ["Dashboard","Gastos","Ingresos","Calendario","Análisis"];
const API_URL = import.meta.env.VITE_API_URL || "http://localhost:3001";
const PROXY_URL = "https://api.allorigins.win/raw?url=";

// ─── HELPERS ────────────────────────────────────────────────────────────────────

function fmt(n, currency = "ARS") {
  if (currency === "USD") return new Intl.NumberFormat("es-AR",{style:"currency",currency:"USD",maximumFractionDigits:2}).format(n||0);
  return new Intl.NumberFormat("es-AR",{style:"currency",currency:"ARS",maximumFractionDigits:0}).format(n||0);
}
function fmtK(v) { if(v>=1000000) return '$'+(v/1000000).toFixed(1)+'M'; if(v>=1000) return '$'+(v/1000).toFixed(0)+'k'; return '$'+Math.round(v); }
function fmtRaw(n) { return Math.round(n||0).toLocaleString('es-AR'); }

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
  const imgW = canvas.width / 2;
  const imgH = canvas.height / 2;
  const pdf = new jsPDF({ orientation: imgW > imgH ? "landscape" : "portrait", unit: "px", format: [imgW + 40, imgH + 60] });
  pdf.setFontSize(13); pdf.setFont("helvetica","bold");
  pdf.text(title, 20, 22);
  pdf.setFontSize(9); pdf.setFont("helvetica","normal");
  pdf.text(new Date().toLocaleDateString("es-AR"), 20, 36);
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

// ─── TIPO DE CAMBIO ─────────────────────────────────────────────────────────────

/**
 * Intenta obtener cotizaciones desde dolarhoy.com via proxy CORS.
 * Devuelve { oficial, blue, mep, tarjeta } o null si falla.
 */
async function fetchDolarHoy() {
  try {
    const url = PROXY_URL + encodeURIComponent("https://dolarhoy.com/");
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
    const html = await res.text();
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");

    // dolarhoy.com estructura: .tile con .title y .values .sell
    const result = {};
    const tiles = doc.querySelectorAll(".tile");
    tiles.forEach(tile => {
      const titleEl = tile.querySelector(".title");
      const sellEl = tile.querySelector(".sell .val") || tile.querySelector(".value .sell");
      if (!titleEl || !sellEl) return;
      const title = titleEl.textContent.trim().toLowerCase();
      const raw = sellEl.textContent.replace(/[^0-9,.]/g,"").replace(",",".");
      const val = parseFloat(raw);
      if (!val || isNaN(val)) return;
      if (title.includes("oficial")) result.oficial = val;
      else if (title.includes("blue")) result.blue = val;
      else if (title.includes("mep") || title.includes("bolsa")) result.mep = val;
      else if (title.includes("tarjeta") || title.includes("turista")) result.tarjeta = val;
    });

    // Fallback: intentar con selectores alternativos
    if (!result.blue) {
      const allVals = doc.querySelectorAll(".sell");
      allVals.forEach((el, i) => {
        const raw = el.textContent.replace(/[^0-9,.]/g,"").replace(",",".");
        const val = parseFloat(raw);
        if (!val || isNaN(val)) return;
        const parent = el.closest(".tile") || el.closest(".cotizacion");
        const label = parent?.querySelector(".title, h2, h3")?.textContent?.toLowerCase() || "";
        if (label.includes("blue") && !result.blue) result.blue = val;
        if (label.includes("oficial") && !result.oficial) result.oficial = val;
        if ((label.includes("mep") || label.includes("bolsa")) && !result.mep) result.mep = val;
      });
    }

    if (Object.keys(result).length === 0) return null;
    return result;
  } catch {
    return null;
  }
}

function TipoCambioPanel({ rates, onRatesChange, lastUpdated, onRefresh, loading }) {
  const [manual, setManual] = useState({});
  const [editMode, setEditMode] = useState(false);
  const [saving, setSaving] = useState(false);

  const displayRates = editMode ? { ...rates, ...manual } : rates;

  const handleSave = async () => {
    setSaving(true);
    const merged = { ...rates, ...manual };
    onRatesChange(merged);
    // Guardar en Supabase
    try {
      await supabase.from("tipo_cambio").upsert(
        Object.entries(merged).map(([tipo, valor]) => ({ tipo, valor, fecha: new Date().toISOString().slice(0,10) })),
        { onConflict: "tipo" }
      );
    } catch {}
    setSaving(false);
    setEditMode(false);
    setManual({});
  };

  const tipos = [
    { key: "oficial", label: "Dólar Oficial", color: "#3266ad" },
    { key: "blue", label: "Dólar Blue", color: "#1d9e75" },
    { key: "mep", label: "Dólar MEP", color: "#d85a30" },
    { key: "tarjeta", label: "Dólar Tarjeta", color: "#8b5cf6" },
  ];

  return (
    <div style={{background:"#fff",border:"1px solid #eee",borderRadius:12,padding:"1.25rem",marginBottom:"1rem"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem",flexWrap:"wrap",gap:8}}>
        <div>
          <h3 style={{margin:"0 0 2px",fontSize:15,fontWeight:500}}>💱 Tipo de cambio</h3>
          {lastUpdated && <p style={{fontSize:11,color:"#999",margin:0}}>Actualizado: {lastUpdated} · Fuente: dolarhoy.com</p>}
        </div>
        <div style={{display:"flex",gap:8}}>
          {editMode
            ? <>
                <button onClick={()=>{setEditMode(false);setManual({});}} style={{fontSize:12,padding:"5px 12px",background:"none",border:"1px solid #ddd",borderRadius:8,cursor:"pointer",color:"#666"}}>Cancelar</button>
                <button onClick={handleSave} disabled={saving} style={{fontSize:12,padding:"5px 14px",background:"#3266ad",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontWeight:500}}>{saving?"Guardando...":"Guardar"}</button>
              </>
            : <>
                <button onClick={onRefresh} disabled={loading} style={{fontSize:12,padding:"5px 12px",background:"#f0f4ff",border:"1px solid #3266ad44",borderRadius:8,cursor:"pointer",color:"#3266ad"}}>
                  {loading ? "⏳ Actualizando..." : "↻ Actualizar"}
                </button>
                <button onClick={()=>setEditMode(true)} style={{fontSize:12,padding:"5px 12px",background:"#f5f5f5",border:"1px solid #ddd",borderRadius:8,cursor:"pointer",color:"#666"}}>✏ Editar manual</button>
              </>
          }
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:10}}>
        {tipos.map(({key, label, color}) => (
          <div key={key} style={{background:"#f9f9f9",borderRadius:8,padding:"0.85rem",textAlign:"center",border:`1px solid ${color}22`}}>
            <p style={{fontSize:11,color:"#666",margin:"0 0 6px"}}>{label}</p>
            {editMode
              ? <input
                  type="number"
                  value={manual[key] ?? (rates[key] || "")}
                  onChange={e => setManual(p => ({...p,[key]:parseFloat(e.target.value)||0}))}
                  style={{width:"100%",padding:"4px 8px",borderRadius:6,border:"1px solid #ddd",fontSize:14,textAlign:"center",fontWeight:500,color,boxSizing:"border-box"}}
                />
              : <p style={{fontSize:18,fontWeight:600,margin:0,color}}>
                  {displayRates[key] ? `$${fmtRaw(displayRates[key])}` : <span style={{fontSize:13,color:"#bbb"}}>—</span>}
                </p>
            }
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── MEDIOS DE PAGO (con opción de agregar) ─────────────────────────────────────

function MedioSelector({ value, onChange, medios, onAddMedio }) {
  const [showAdd, setShowAdd] = useState(false);
  const [newMedio, setNewMedio] = useState("");

  const handleAdd = () => {
    const v = newMedio.trim();
    if (!v) return;
    onAddMedio(v);
    onChange(v);
    setNewMedio("");
    setShowAdd(false);
  };

  return (
    <div style={{display:"flex",gap:6}}>
      <select
        value={value}
        onChange={e => {
          if (e.target.value === "__add__") { setShowAdd(true); return; }
          onChange(e.target.value);
        }}
        style={{flex:1,padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}
      >
        {medios.map(m => <option key={m}>{m}</option>)}
        <option value="__add__">+ Agregar nuevo...</option>
      </select>
      {showAdd && (
        <div style={{display:"flex",gap:6,flex:1}}>
          <input
            autoFocus
            value={newMedio}
            onChange={e => setNewMedio(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleAdd()}
            placeholder="Nombre del medio..."
            style={{flex:1,padding:"7px 10px",borderRadius:8,border:"1px solid #3266ad",fontSize:13,boxSizing:"border-box"}}
          />
          <button onClick={handleAdd} style={{padding:"7px 12px",background:"#3266ad",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:13}}>✓</button>
          <button onClick={()=>{setShowAdd(false);setNewMedio("");}} style={{padding:"7px 10px",background:"none",border:"1px solid #ddd",borderRadius:8,cursor:"pointer",fontSize:13,color:"#999"}}>✕</button>
        </div>
      )}
    </div>
  );
}

// ─── EXPANDABLE TABLE ────────────────────────────────────────────────────────────

function ExpandableTable({ expenses, categories }) {
  const [expanded, setExpanded] = useState({});
  if (!expenses.length) return <p style={{fontSize:13,color:"#999"}}>Sin datos.</p>;
  const months = [...new Set(expenses.map(e=>e.date?.slice(0,7)).filter(Boolean))].sort().reverse().slice(0,6);
  const toggle = (k) => setExpanded(p=>({...p,[k]:!p[k]}));
  const sumCat = (cat,m) => expenses.filter(e=>e.category===cat&&e.date?.startsWith(m)).reduce((s,e)=>s+e.amount,0);
  const sumSub = (sub,m) => expenses.filter(e=>e.subcat===sub&&e.date?.startsWith(m)).reduce((s,e)=>s+e.amount,0);
  const grandTotal = (m) => expenses.filter(e=>e.date?.startsWith(m)).reduce((s,e)=>s+e.amount,0);
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
                  {months.map(m=>{ const tot=sumCat(k,m); return <td key={m} style={{textAlign:"right",padding:"8px 10px",fontWeight:500,color:tot>0?"#1a1a1a":"#ccc"}}>{tot>0?fmt(tot):"—"}</td>; })}
                </tr>
                {expanded[k]&&subcats.map(sub=>{
                  const hasData=months.some(m=>sumSub(sub,m)>0);
                  if(!hasData) return null;
                  return(
                    <tr key={sub} style={{borderBottom:"1px solid #f5f5f5",background:"#fafafa"}}>
                      <td style={{padding:"5px 10px 5px 32px",color:"#666",borderLeft:`2px solid ${v.color}44`,fontSize:12}}>{sub}</td>
                      {months.map(m=>{ const tot=sumSub(sub,m); return <td key={m} style={{textAlign:"right",padding:"5px 10px",fontSize:12,color:tot>0?"#1a1a1a":"#ddd"}}>{tot>0?fmt(tot):"—"}</td>; })}
                    </tr>
                  );
                })}
                {expanded[k]&&<tr><td colSpan={months.length+1} style={{padding:0,borderBottom:"1px solid #eee"}}></td></tr>}
              </React.Fragment>
            );
          })}
          <tr style={{borderTop:"1px solid #eee",fontWeight:500}}>
            <td style={{padding:"8px 10px"}}>Total</td>
            {months.map(m=><td key={m} style={{textAlign:"right",padding:"8px 10px",color:"#3266ad"}}>{fmt(grandTotal(m))}</td>)}
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
  const handleSave=async()=>{ setSaving(true); await supabase.from("categorias").delete().neq("id",0); const rows=[]; Object.entries(cats).forEach(([foco,v])=>{ v.subcats.forEach(sub=>{ rows.push({foco,foco_label:v.label,foco_icon:v.icon,foco_color:v.color,subcat:sub}); }); }); if(rows.length) await supabase.from("categorias").insert(rows); onSave(cats); setSaving(false); onClose(); };
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

// ─── DASHBOARD ───────────────────────────────────────────────────────────────────

function Dashboard({ expenses, incomes, categories, rates, activeRate }) {
  const [dashTab, setDashTab] = useState("resumen");
  const [selectedMonth, setSelectedMonth] = useState(String(new Date().getMonth()+1));
  const [selectedYear] = useState(new Date().getFullYear());
  const [selectedConcepto, setSelectedConcepto] = useState("");
  const chart1Ref=useRef(null); const chart2Ref=useRef(null); const chart3Ref=useRef(null);
  const c1=useRef(null); const c2=useRef(null); const c3=useRef(null);
  const isYearView = selectedMonth === "all";

  // Conversión a USD
  const toUSD = (amount, currency) => {
    if (currency === "USD") return amount;
    const rate = rates[activeRate] || 1;
    return rate > 0 ? amount / rate : 0;
  };

  const allSubcats=[...new Set(expenses.map(e=>e.subcat))].sort();
  useEffect(()=>{ if(allSubcats.length&&!selectedConcepto) setSelectedConcepto(allSubcats[0]); },[expenses]);

  const monthStr=`${selectedYear}-${String(selectedMonth).padStart(2,"0")}`;
  const monthExp = isYearView
    ? expenses.filter(e=>e.date?.startsWith(String(selectedYear)))
    : expenses.filter(e=>e.date?.startsWith(monthStr));
  const monthInc = isYearView
    ? incomes.filter(i=>i.date?.startsWith(String(selectedYear)))
    : incomes.filter(i=>i.date?.startsWith(monthStr));

  const toUSDe = (e) => toUSD(e.amount, e.moneda);
  const toUSDi = (i) => toUSD(i.amount, i.moneda);

  const totalGastosUSD = monthExp.reduce((s,e)=>s+toUSDe(e),0);
  const totalIngresosUSD = monthInc.reduce((s,i)=>s+toUSDi(i),0);
  const balanceUSD = totalIngresosUSD - totalGastosUSD;
  const pagadoUSD = monthExp.filter(e=>e.pagado).reduce((s,e)=>s+toUSDe(e),0);
  const pendienteUSD = totalGastosUSD - pagadoUSD;

  const months=[...new Set([...expenses,...incomes].map(e=>e.date?.slice(0,7)).filter(Boolean))].sort();
  const monthlyByCat=(cat)=>months.map(m=>expenses.filter(e=>e.category===cat&&e.date?.startsWith(m)).reduce((s,e)=>s+toUSDe(e),0));

  const conceptoData=selectedConcepto?months.map(m=>expenses.filter(e=>e.subcat===selectedConcepto&&e.date?.startsWith(m)).reduce((s,e)=>s+toUSDe(e),0)):[];
  const nonZero=conceptoData.filter(v=>v>0);
  const avg=nonZero.length?nonZero.reduce((a,b)=>a+b,0)/nonZero.length:0;
  const maxVal=conceptoData.length?Math.max(...conceptoData):0;
  const minVal=nonZero.length?Math.min(...nonZero):0;

  const rateLabel = activeRate ? `Cotización ${activeRate}: $${fmtRaw(rates[activeRate]||0)} ARS/USD` : "Sin cotización";

  const exportDashboardCSV=()=>{ const label=isYearView?`Año ${selectedYear}`:`${MONTHS_FULL[parseInt(selectedMonth)-1]} ${selectedYear}`; const rows=[["Foco","Categoría","Monto ARS","Moneda","Monto USD","Estado"]]; monthExp.forEach(e=>rows.push([categories[e.category]?.label||e.category,e.subcat,fmtRaw(e.amount),e.moneda||"ARS",fmtRaw(toUSDe(e)),e.pagado?"Pagado":"Pendiente"])); rows.push(["","Total","","",(totalGastosUSD).toFixed(2),""]); exportCSV(rows,`dashboard_${label.replace(/\s/g,"_")}`); };
  const exportDashboardPDF=async()=>{ const label=isYearView?`Año ${selectedYear}`:`${MONTHS_FULL[parseInt(selectedMonth)-1]} ${selectedYear}`; await exportPDF(`Dashboard — ${label}`,`dashboard_${label.replace(/\s/g,"_")}`,"section-dashboard"); };

  useEffect(()=>{
    if(dashTab!=="resumen"||!chart1Ref.current) return;
    if(c1.current) c1.current.destroy();
    const catLabels=Object.values(categories).map(v=>v.label);
    const catData=Object.keys(categories).map(k=>monthExp.filter(e=>e.category===k).reduce((s,e)=>s+toUSDe(e),0));
    const catColors=Object.values(categories).map(v=>v.color);
    c1.current=new window.Chart(chart1Ref.current,{type:"bar",data:{labels:catLabels,datasets:[{data:catData,backgroundColor:catColors,borderRadius:4,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmt(c.raw,"USD")}}},scales:{x:{ticks:{autoSkip:false}},y:{ticks:{callback:v=>"U$S "+fmtK(v).replace("$","")}}}}}); 
    return()=>{ if(c1.current) c1.current.destroy(); };
  },[dashTab,selectedMonth,expenses,rates,activeRate]);

  useEffect(()=>{
    if(dashTab!=="comparador"||!chart2Ref.current||!selectedConcepto) return;
    if(c2.current) c2.current.destroy();
    c2.current=new window.Chart(chart2Ref.current,{type:"bar",data:{labels:months.map(m=>m.slice(5)),datasets:[{data:conceptoData,backgroundColor:conceptoData.map(v=>v===maxVal&&v>0?"#3266ad":"#85b7eb"),borderRadius:4,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>fmt(c.raw,"USD")}}},scales:{x:{ticks:{autoSkip:false}},y:{ticks:{callback:v=>"U$S "+v.toFixed(0)}}}}});
    if(c3.current) c3.current.destroy();
    const varData=months.slice(1).map((_,i)=>{ const p=conceptoData[i],c=conceptoData[i+1]; return(!p||!c)?0:Math.round(((c-p)/p)*100); });
    c3.current=new window.Chart(chart3Ref.current,{type:"bar",data:{labels:months.slice(1).map(m=>m.slice(5)),datasets:[{data:varData,backgroundColor:varData.map(v=>v>0?"#e24b4a":"#1d9e75"),borderRadius:4,borderSkipped:false}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>(c.raw>0?"+":"")+c.raw+"%"}}},scales:{x:{ticks:{autoSkip:false}},y:{ticks:{callback:v=>v+"%"}}}}});
    return()=>{ if(c2.current) c2.current.destroy(); if(c3.current) c3.current.destroy(); };
  },[dashTab,selectedConcepto,expenses,rates,activeRate]);

  useEffect(()=>{
    if(dashTab!=="evolucion"||!chart1Ref.current) return;
    if(c1.current) c1.current.destroy();
    // Gastos e ingresos por mes
    const gastosByMonth = months.map(m => expenses.filter(e=>e.date?.startsWith(m)).reduce((s,e)=>s+toUSDe(e),0));
    const ingresosByMonth = months.map(m => incomes.filter(i=>i.date?.startsWith(m)).reduce((s,i)=>s+toUSDi(i),0));
    c1.current=new window.Chart(chart1Ref.current,{type:"bar",data:{labels:months.map(m=>m.slice(5)),datasets:[
      {label:"Ingresos",data:ingresosByMonth,backgroundColor:"#1d9e7566",borderColor:"#1d9e75",borderWidth:1,borderRadius:3},
      ...Object.entries(categories).map(([k,v])=>({label:v.label,data:monthlyByCat(k),backgroundColor:v.color,stack:"gastos",borderRadius:2}))
    ]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:true,position:"bottom"}},scales:{x:{stacked:true,ticks:{autoSkip:false}},y:{stacked:false,ticks:{callback:v=>"U$S "+v.toFixed(0)}}}}});
    return()=>{ if(c1.current) c1.current.destroy(); };
  },[dashTab,expenses,incomes,rates,activeRate]);

  const tabStyle=(t)=>({padding:"8px 16px",fontSize:13,background:"none",border:"none",borderBottom:dashTab===t?"2px solid #3266ad":"2px solid transparent",color:dashTab===t?"#3266ad":"#666",cursor:"pointer",fontWeight:dashTab===t?500:400});

  return (
    <div>
      {/* Selector de cotización activa */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:"1rem",padding:"8px 14px",background:"#f0f4ff",borderRadius:8,fontSize:13}}>
        <span style={{color:"#3266ad",fontWeight:500}}>💱 Visualizando en USD</span>
        <span style={{color:"#666"}}>·</span>
        <span style={{color:"#666"}}>{rateLabel}</span>
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
              <span style={{fontSize:14,fontWeight:500}}>{isYearView?"Período":"Mes"} a analizar</span>
              <select value={selectedMonth} onChange={e=>setSelectedMonth(e.target.value)} style={{padding:"6px 12px",borderRadius:8,border:"1px solid #ddd",fontSize:13}}>
                <option value="all">Año {selectedYear}</option>
                {MONTHS_FULL.map((m,i)=><option key={i} value={String(i+1)}>{m} {selectedYear}</option>)}
              </select>
            </div>
            <ExportButtons onCSV={exportDashboardCSV} onPDF={exportDashboardPDF}/>
          </div>

          {/* KPIs principales */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:"1rem"}}>
            {[
              [isYearView?"Total gastos año":"Total gastos mes", totalGastosUSD, "#e24b4a"],
              [isYearView?"Total ingresos año":"Total ingresos mes", totalIngresosUSD, "#1d9e75"],
              [isYearView?"Balance año":"Balance mes", balanceUSD, balanceUSD >= 0 ? "#3266ad" : "#e24b4a"],
            ].map(([l,v,c])=>(
              <div key={l} style={{background:"#f9f9f9",borderRadius:8,padding:"1rem",textAlign:"center",border:`1px solid ${c}22`}}>
                <p style={{fontSize:11,color:"#666",margin:"0 0 4px"}}>{l}</p>
                <p style={{fontSize:18,fontWeight:600,margin:0,color:c}}>{fmt(v,"USD")}</p>
              </div>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(2,1fr)",gap:10,marginBottom:"1rem"}}>
            {[
              ["Pagado",pagadoUSD,"#1d9e75"],
              ["Pendiente",pendienteUSD,"#e24b4a"],
            ].map(([l,v,c])=>(
              <div key={l} style={{background:"#f9f9f9",borderRadius:8,padding:"0.85rem",textAlign:"center"}}>
                <p style={{fontSize:11,color:"#666",margin:"0 0 4px"}}>{l}</p>
                <p style={{fontSize:15,fontWeight:500,margin:0,color:c}}>{fmt(v,"USD")}</p>
              </div>
            ))}
          </div>

          <div style={{display:"grid",gridTemplateColumns:`repeat(${Object.keys(categories).length},1fr)`,gap:10,marginBottom:"1rem"}}>
            {Object.entries(categories).map(([k,v])=>{
              const cats=monthExp.filter(e=>e.category===k);
              const total=cats.reduce((s,e)=>s+toUSDe(e),0);
              const bySub={};
              cats.forEach(e=>{bySub[e.subcat]=(bySub[e.subcat]||0)+toUSDe(e);});
              const top=Object.entries(bySub).sort(([,a],[,b])=>b-a);
              return(
                <div key={k} style={{background:"#fff",border:"1px solid #eee",borderRadius:12,padding:"1rem"}}>
                  <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:6}}>
                    <span style={{fontSize:16}}>{v.icon}</span>
                    <span style={{fontWeight:500,fontSize:14}}>{v.label}</span>
                  </div>
                  <p style={{fontSize:18,fontWeight:500,margin:"0 0 8px",color:v.color}}>{fmt(total,"USD")}</p>
                  {top.length===0&&<p style={{fontSize:11,color:"#999"}}>Sin gastos</p>}
                  {top.map(([sub,amt])=>(
                    <div key={sub} style={{display:"flex",justifyContent:"space-between",fontSize:11,padding:"2px 0",borderBottom:"1px solid #f0f0f0"}}>
                      <span style={{color:"#666",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"60%"}}>{sub}</span>
                      <span style={{fontWeight:500}}>{fmt(amt,"USD")}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
          <div style={{background:"#fff",border:"1px solid #eee",borderRadius:12,padding:"1.25rem"}}>
            <p style={{fontSize:14,fontWeight:500,margin:"0 0 10px"}}>Distribución por foco (USD)</p>
            <div style={{display:"flex",gap:16,marginBottom:10,fontSize:12,color:"#666"}}>
              {Object.entries(categories).map(([k,v])=><span key={k} style={{display:"flex",alignItems:"center",gap:4}}><span style={{width:10,height:10,borderRadius:2,background:v.color,display:"inline-block"}}></span>{v.label}</span>)}
            </div>
            <div style={{position:"relative",height:180}}><canvas ref={chart1Ref}></canvas></div>
          </div>
        </div>
      )}

      {dashTab==="comparador"&&(
        <div id="section-comparador">
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:"1rem",flexWrap:"wrap",gap:8}}>
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <span style={{fontSize:13,color:"#666"}}>Concepto:</span>
              <select value={selectedConcepto} onChange={e=>setSelectedConcepto(e.target.value)} style={{padding:"6px 12px",borderRadius:8,border:"1px solid #ddd",fontSize:13}}>
                {allSubcats.map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:10,marginBottom:"1rem"}}>
            {[["Promedio",fmt(avg,"USD"),"#3266ad"],["Máximo",fmt(maxVal,"USD"),"#e24b4a"],["Mínimo",fmt(minVal,"USD"),"#1d9e75"],["Meses c/dato",nonZero.length+" / "+months.length,"#888"]].map(([l,v,c])=>(
              <div key={l} style={{background:"#f9f9f9",borderRadius:8,padding:".85rem",textAlign:"center"}}>
                <p style={{fontSize:11,color:"#666",margin:"0 0 4px"}}>{l}</p>
                <p style={{fontSize:14,fontWeight:500,margin:0,color:c}}>{v}</p>
              </div>
            ))}
          </div>
          <div style={{background:"#fff",border:"1px solid #eee",borderRadius:12,padding:"1.25rem",marginBottom:"1rem"}}>
            <p style={{fontSize:14,fontWeight:500,margin:"0 0 10px"}}>Evolución mensual — {selectedConcepto} (USD)</p>
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
            <p style={{fontSize:14,fontWeight:500,margin:"0 0 4px"}}>Gastos vs Ingresos por mes — {selectedYear} (USD)</p>
            <div style={{position:"relative",height:250}}><canvas ref={chart1Ref}></canvas></div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:`repeat(${Object.keys(categories).length},1fr)`,gap:10}}>
            {Object.entries(categories).map(([k,v])=>(
              <div key={k} style={{background:"#f9f9f9",borderRadius:8,padding:"1rem",textAlign:"center"}}>
                <p style={{fontSize:11,color:"#666",margin:"0 0 4px"}}>{v.icon} {v.label}</p>
                <p style={{fontSize:16,fontWeight:500,margin:0,color:v.color}}>{fmt(expenses.filter(e=>e.category===k).reduce((s,e)=>s+toUSDe(e),0),"USD")}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── INGRESOS TAB ────────────────────────────────────────────────────────────────

function IngresosTab({ incomes, onAdd, onEdit, onDelete, medios, onAddMedio, rates, activeRate, incomeCategories, onUpdateIncomeCategories }) {
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState(null);
  const [filterMonth, setFilterMonth] = useState("all");
  const [filterCat, setFilterCat] = useState("all");
  const [showCatEditor, setShowCatEditor] = useState(false);
  const [newCat, setNewCat] = useState("");
  const [form, setForm] = useState({
    category: incomeCategories[0] || "Sueldo",
    amount: "",
    moneda: "ARS",
    date: new Date().toISOString().slice(0,10),
    desc: "",
    medio: medios[0] || "Transferencia",
  });

  const toUSD = (amount, moneda) => {
    if (moneda === "USD") return amount;
    const rate = rates[activeRate] || 1;
    return rate > 0 ? amount / rate : 0;
  };

  const filtered = incomes.filter(i => {
    const mm = filterMonth === "all" || i.date?.startsWith(`${new Date().getFullYear()}-${String(filterMonth).padStart(2,"0")}`);
    const mc = filterCat === "all" || i.category === filterCat;
    return mm && mc;
  });

  const totalUSD = filtered.reduce((s,i) => s + toUSD(i.amount, i.moneda), 0);

  const handleSubmit = async () => {
    if (!form.amount || !form.date) return;
    const row = {
      category: form.category,
      amount: parseFloat(form.amount),
      moneda: form.moneda,
      date: form.date,
      descripcion: form.desc,
      medio: form.medio,
    };
    if (editId) {
      const { error } = await supabase.from("ingresos").update(row).eq("id", editId);
      if (!error) onEdit({ ...row, id: editId });
    } else {
      const { data } = await supabase.from("ingresos").insert(row).select();
      if (data?.[0]) onAdd({ ...row, id: String(data[0].id) });
    }
    setForm({ category: incomeCategories[0], amount: "", moneda: "ARS", date: new Date().toISOString().slice(0,10), desc: "", medio: medios[0] });
    setEditId(null);
    setShowForm(false);
  };

  const handleEdit = (i) => {
    setForm({ category: i.category, amount: String(i.amount), moneda: i.moneda || "ARS", date: i.date, desc: i.desc || "", medio: i.medio || medios[0] });
    setEditId(i.id);
    setShowForm(true);
  };

  const handleDelete = async (id) => {
    await supabase.from("ingresos").delete().eq("id", id);
    onDelete(id);
  };

  const handleAddCat = () => {
    const v = newCat.trim();
    if (!v || incomeCategories.includes(v)) return;
    onUpdateIncomeCategories([...incomeCategories, v]);
    setNewCat("");
  };

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
        <button onClick={()=>{setShowForm(true);setEditId(null);setForm({category:incomeCategories[0],amount:"",moneda:"ARS",date:new Date().toISOString().slice(0,10),desc:"",medio:medios[0]});}} style={{fontSize:13,padding:"6px 14px",background:"#1d9e75",border:"none",borderRadius:8,cursor:"pointer",color:"#fff",fontWeight:500}}>+ Nuevo Ingreso</button>
      </div>

      {showCatEditor && (
        <div style={{background:"#f0faf5",border:"1px solid #1d9e7533",borderRadius:10,padding:"1rem",marginBottom:"1rem"}}>
          <p style={{fontSize:13,fontWeight:500,margin:"0 0 10px",color:"#0f6e56"}}>Categorías de ingresos</p>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
            {incomeCategories.map(c=>(
              <span key={c} style={{display:"inline-flex",alignItems:"center",gap:4,fontSize:12,padding:"3px 10px",borderRadius:20,background:"#1d9e7522",color:"#0f6e56"}}>
                {c}
                <span onClick={()=>onUpdateIncomeCategories(incomeCategories.filter(x=>x!==c))} style={{cursor:"pointer",fontWeight:700,fontSize:14}}>×</span>
              </span>
            ))}
          </div>
          <div style={{display:"flex",gap:6}}>
            <input value={newCat} onChange={e=>setNewCat(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handleAddCat()} placeholder="Nueva categoría..." style={{flex:1,padding:"6px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:13}}/>
            <button onClick={handleAddCat} style={{padding:"6px 14px",background:"#1d9e75",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:13}}>+ Agregar</button>
          </div>
        </div>
      )}

      {showForm && (
        <div style={{background:"#fff",border:"1px solid #e0e0e0",borderRadius:12,padding:"1.25rem",marginBottom:"1.5rem"}}>
          <h3 style={{margin:"0 0 1rem",fontSize:16,fontWeight:500}}>{editId?"Editar ingreso":"Nuevo ingreso"}</h3>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <div>
              <label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Categoría</label>
              <select value={form.category} onChange={e=>setForm(p=>({...p,category:e.target.value}))} style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}>
                {incomeCategories.map(c=><option key={c}>{c}</option>)}
              </select>
            </div>
            <div>
              <label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Moneda</label>
              <div style={{display:"flex",gap:6}}>
                {["ARS","USD"].map(m=>(
                  <button key={m} onClick={()=>setForm(p=>({...p,moneda:m}))} style={{flex:1,padding:"7px",borderRadius:8,border:`1px solid ${form.moneda===m?"#1d9e75":"#ddd"}`,background:form.moneda===m?"#f0faf5":"#fff",color:form.moneda===m?"#0f6e56":"#666",fontWeight:form.moneda===m?600:400,cursor:"pointer",fontSize:14}}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Monto ({form.moneda})</label>
              <input type="number" value={form.amount} onChange={e=>setForm(p=>({...p,amount:e.target.value}))} placeholder="0" style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}/>
            </div>
            <div>
              <label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Fecha</label>
              <input type="date" value={form.date} onChange={e=>setForm(p=>({...p,date:e.target.value}))} style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}/>
            </div>
            <div>
              <label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Descripción</label>
              <input type="text" value={form.desc} onChange={e=>setForm(p=>({...p,desc:e.target.value}))} placeholder="Ej: Sueldo Abril" style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}/>
            </div>
            <div>
              <label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Medio de cobro</label>
              <MedioSelector value={form.medio} onChange={v=>setForm(p=>({...p,medio:v}))} medios={medios} onAddMedio={onAddMedio}/>
            </div>
          </div>
          <div style={{display:"flex",gap:8,marginTop:"1rem"}}>
            <button onClick={handleSubmit} style={{padding:"8px 20px",background:"#1d9e75",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",fontSize:14,fontWeight:500}}>{editId?"Guardar cambios":"Agregar ingreso"}</button>
            <button onClick={()=>{setShowForm(false);setEditId(null);}} style={{padding:"8px 16px",background:"none",border:"1px solid #ddd",borderRadius:8,cursor:"pointer",fontSize:14,color:"#666"}}>Cancelar</button>
          </div>
        </div>
      )}

      {filtered.length === 0
        ? <div style={{textAlign:"center",padding:"3rem",color:"#999",fontSize:14}}>No hay ingresos registrados.</div>
        : <div style={{display:"flex",flexDirection:"column",gap:6}}>
            {filtered.sort((a,b)=>b.date?.localeCompare(a.date)).map(i=>{
              const usd = toUSD(i.amount, i.moneda);
              return (
                <div key={i.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#fff",border:"1px solid #1d9e7533",borderLeft:"3px solid #1d9e75",borderRadius:8,padding:"10px 14px",gap:8}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0}}>
                    <span style={{fontSize:16}}>💰</span>
                    <div style={{minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                        <span style={{fontSize:13,fontWeight:500}}>{i.category}</span>
                        <span style={{fontSize:11,padding:"2px 7px",borderRadius:20,background:"#1d9e7522",color:"#0f6e56"}}>{i.medio||"—"}</span>
                        <span style={{fontSize:11,padding:"2px 7px",borderRadius:20,background:i.moneda==="USD"?"#3266ad22":"#f5f5f5",color:i.moneda==="USD"?"#185fa5":"#666",fontWeight:i.moneda==="USD"?500:400}}>{i.moneda||"ARS"}</span>
                      </div>
                      <div style={{fontSize:11,color:"#999",marginTop:2}}>{i.desc||"—"} · {i.date}</div>
                    </div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontWeight:600,fontSize:14,color:"#1d9e75"}}>
                        {i.moneda==="USD" ? fmt(i.amount,"USD") : fmt(i.amount,"ARS")}
                      </div>
                      {i.moneda==="ARS" && rates[activeRate] && (
                        <div style={{fontSize:11,color:"#999"}}>{fmt(usd,"USD")}</div>
                      )}
                    </div>
                    <button onClick={()=>handleEdit(i)} style={{fontSize:12,padding:"3px 10px",background:"none",border:"1px solid #ddd",borderRadius:8,cursor:"pointer",color:"#666"}}>Editar</button>
                    <button onClick={()=>handleDelete(i.id)} style={{fontSize:12,padding:"3px 8px",background:"none",border:"1px solid #ddd",borderRadius:8,cursor:"pointer",color:"#e24b4a"}}>✕</button>
                  </div>
                </div>
              );
            })}
          </div>
      }
      {filtered.length > 0 && (
        <div style={{marginTop:12,display:"flex",justifyContent:"flex-end",gap:16,fontSize:14,fontWeight:500}}>
          <span style={{color:"#666"}}>Total filtrado:</span>
          <span style={{color:"#1d9e75"}}>{fmt(totalUSD,"USD")}</span>
        </div>
      )}
    </div>
  );
}

// ─── LOGIN ────────────────────────────────────────────────────────────────────────

function Login() {
  const [email,setEmail]=useState(""); const [password,setPassword]=useState(""); const [error,setError]=useState(""); const [loading,setLoading]=useState(false);
  const handleLogin=async()=>{ setLoading(true); setError(""); const {error}=await supabase.auth.signInWithPassword({email,password}); if(error) setError("Email o contraseña incorrectos"); setLoading(false); };
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

  // Tipo de cambio
  const [rates,setRates]=useState({ oficial:0, blue:0, mep:0, tarjeta:0 });
  const [activeRate,setActiveRate]=useState("blue"); // cotización usada para conversión
  const [ratesLoading,setRatesLoading]=useState(false);
  const [ratesLastUpdated,setRatesLastUpdated]=useState(null);

  const [form,setForm]=useState({
    category:"hogar",subcat:"Luz",amount:"",moneda:"ARS",
    date:new Date().toISOString().slice(0,10),desc:"",dueDate:"",
    recurring:false,fileName:"",medio:"Transferencia",pagado:false
  });
  const [calMonth,setCalMonth]=useState(new Date().getMonth()); const [calYear,setCalYear]=useState(new Date().getFullYear());
  const [filterCat,setFilterCat]=useState("all"); const [filterMonth,setFilterMonth]=useState("all");
  const [filterPagado,setFilterPagado]=useState("all"); const [filterSubcat,setFilterSubcat]=useState("all");
  const [aiLoading,setAiLoading]=useState(false); const [aiResult,setAiResult]=useState("");
  const [importMsg,setImportMsg]=useState("");
  const fileRef=useRef(); const importRef=useRef();

  // Auth
  useEffect(()=>{ supabase.auth.getSession().then(({data:{session}})=>{setSession(session);setLoadingSession(false);}); const {data:{subscription}}=supabase.auth.onAuthStateChange((_e,session)=>setSession(session)); return()=>subscription.unsubscribe(); },[]);
  useEffect(()=>{ if(session){loadExpenses();loadCategories();loadIncomes();loadRates();loadMedios();loadIncomeCategories();} },[session]);
  useEffect(()=>{ if(tab==="Dashboard"||tab==="Análisis"){ if(!window.Chart){ const s=document.createElement("script"); s.src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js"; s.async=true; document.head.appendChild(s); } } },[tab]);

  // Carga de datos
  const loadExpenses=async()=>{ setLoadingData(true); const {data,error}=await supabase.from("gastos").select("*").order("id",{ascending:false}); if(!error&&data) setExpenses(data.map(e=>({id:String(e.id),category:e.category,subcat:e.subcat,amount:e.amount,moneda:e.moneda||"ARS",date:e.date,dueDate:e.due_date,desc:e.descripcion,medio:e.medio,pagado:e.pagado,recurring:e.recurring,fileName:e.file_name}))); setLoadingData(false); };
  const loadIncomes=async()=>{ const {data,error}=await supabase.from("ingresos").select("*").order("id",{ascending:false}); if(!error&&data) setIncomes(data.map(i=>({id:String(i.id),category:i.category,amount:i.amount,moneda:i.moneda||"ARS",date:i.date,desc:i.descripcion,medio:i.medio}))); };
  const loadCategories=async()=>{ const {data}=await supabase.from("categorias").select("*"); if(data&&data.length){ const cats={}; data.forEach(r=>{ if(!cats[r.foco]) cats[r.foco]={label:r.foco_label,icon:r.foco_icon,color:r.foco_color,subcats:[]}; cats[r.foco].subcats.push(r.subcat); }); setCategories({...DEFAULT_CATEGORIES,...cats}); } };
  const loadMedios=async()=>{ const {data}=await supabase.from("medios_pago").select("nombre"); if(data&&data.length){ const extras=data.map(d=>d.nombre).filter(m=>!BASE_MEDIOS.includes(m)); setMedios([...BASE_MEDIOS,...extras]); } };
  const loadIncomeCategories=async()=>{ const {data}=await supabase.from("categorias_ingreso").select("nombre"); if(data&&data.length) setIncomeCategories(data.map(d=>d.nombre)); };

  const loadRates=async()=>{
    // Intentar cargar desde Supabase primero
    const {data}=await supabase.from("tipo_cambio").select("*");
    if(data&&data.length){ const r={}; data.forEach(d=>r[d.tipo]=d.valor); setRates(r); setRatesLastUpdated("(guardado)"); }
    // Luego intentar actualizar desde dolarhoy
    await refreshRates();
  };

  const refreshRates=async()=>{
    setRatesLoading(true);
    const fetched=await fetchDolarHoy();
    if(fetched&&Object.keys(fetched).length>0){
      setRates(p=>({...p,...fetched}));
      setRatesLastUpdated(new Date().toLocaleTimeString("es-AR",{hour:"2-digit",minute:"2-digit"}));
      // Persistir
      try{
        await supabase.from("tipo_cambio").upsert(
          Object.entries(fetched).map(([tipo,valor])=>({tipo,valor,fecha:new Date().toISOString().slice(0,10)})),
          {onConflict:"tipo"}
        );
      }catch{}
    }
    setRatesLoading(false);
  };

  const handleAddMedio=async(nombre)=>{
    if(medios.includes(nombre)) return;
    setMedios(p=>[...p,nombre]);
    try{ await supabase.from("medios_pago").insert({nombre}); }catch{}
  };

  const handleUpdateIncomeCategories=async(cats)=>{
    setIncomeCategories(cats);
    try{ await supabase.from("categorias_ingreso").delete().neq("id",0); if(cats.length) await supabase.from("categorias_ingreso").insert(cats.map(nombre=>({nombre}))); }catch{}
  };

  const handleImportCSV=async(e)=>{ const f=e.target.files[0]; if(!f) return; setImportMsg("Importando..."); const text=await f.text(); const lines=text.split("\n").filter(l=>l.trim()); const rows=lines.slice(1).map(line=>{ const cols=line.split(",").map(c=>c.replace(/^"|"$/g,"").trim()); const pd=d=>d?.includes("/")?d.split("/").reverse().join("-"):d; return{category:cols[1]==="Hogar"?"hogar":cols[1]==="Autos"?"autos":"hijos",subcat:cols[2],descripcion:cols[3],amount:parseFloat(cols[4])||0,moneda:cols[5]||"ARS",date:pd(cols[6]),due_date:pd(cols[7])||null,medio:cols[8],pagado:cols[9]==="Pagado",recurring:cols[10]==="Sí",file_name:cols[11]||""}; }).filter(r=>r.subcat&&r.amount); const{error}=await supabase.from("gastos").insert(rows); if(error) setImportMsg("Error: "+error.message); else{setImportMsg(`✓ ${rows.length} gastos importados`);loadExpenses();} setTimeout(()=>setImportMsg(""),4000); e.target.value=""; };
  const togglePagado=async(id)=>{ const e=expenses.find(x=>x.id===id); await supabase.from("gastos").update({pagado:!e.pagado}).eq("id",id); setExpenses(p=>p.map(x=>x.id===id?{...x,pagado:!x.pagado}:x)); };
  const wakeBackend=async()=>{ try{await fetch(`${API_URL}/`);}catch{} };
  const handleFile=async(e)=>{ const f=e.target.files[0]; if(!f) return; setForm(p=>({...p,fileName:f.name})); if(f.type==="application/pdf"||f.type.startsWith("image/")){ setAiLoading(true); setAiResult("Despertando servidor..."); await wakeBackend(); setAiResult("Analizando archivo con IA..."); try{ const b64=await new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=rej;r.readAsDataURL(f);}); let parsed=null; for(let i=1;i<=3;i++){ try{ setAiResult(`Analizando... (intento ${i}/3)`); const resp=await fetch(`${API_URL}/api/analyze`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({base64:b64,mediaType:f.type}),signal:AbortSignal.timeout(60000)}); parsed=await resp.json(); break; }catch{if(i<3) await new Promise(r=>setTimeout(r,3000));} } if(parsed&&!parsed.error){ setAiResult("✓ "+(parsed.descripcion||"Archivo procesado")); setForm(prev=>({...prev,amount:parsed.monto?String(parsed.monto):prev.amount,date:parsed.fecha||prev.date,dueDate:parsed.vencimiento||prev.dueDate,desc:parsed.descripcion||prev.desc,subcat:parsed.categoria_sugerida||prev.subcat,category:parsed.foco_sugerido||prev.category})); }else setAiResult("No se pudo extraer datos. Completá manualmente."); }catch{setAiResult("Error procesando el archivo.");} setAiLoading(false); } };

  const handleSubmit=async()=>{
    if(!form.amount||!form.date) return;
    const row={category:form.category,subcat:form.subcat,amount:parseFloat(form.amount),moneda:form.moneda,date:form.date,due_date:form.dueDate||null,descripcion:form.desc,medio:form.medio,pagado:form.pagado,recurring:form.recurring,file_name:form.fileName};
    if(editId){ await supabase.from("gastos").update(row).eq("id",editId); setExpenses(p=>p.map(e=>e.id===editId?{...form,id:editId,amount:parseFloat(form.amount)}:e)); setEditId(null); }
    else{ const{data}=await supabase.from("gastos").insert(row).select(); if(data?.[0]) setExpenses(p=>[{...form,id:String(data[0].id),amount:parseFloat(form.amount)},...p]); }
    setForm({category:Object.keys(categories)[0],subcat:Object.values(categories)[0].subcats[0]||"",amount:"",moneda:"ARS",date:new Date().toISOString().slice(0,10),desc:"",dueDate:"",recurring:false,fileName:"",medio:"Transferencia",pagado:false});
    setAiResult(""); setShowForm(false);
  };

  const del=async(id)=>{ await supabase.from("gastos").delete().eq("id",id); setExpenses(p=>p.filter(e=>e.id!==id)); };
  const edit=(e)=>{ setForm({...e,amount:String(e.amount)}); setEditId(e.id); setShowForm(true); };

  const filtered=expenses.filter(e=>{ const mc=filterCat==="all"||e.category===filterCat; const mm=filterMonth==="all"||e.date?.startsWith(`${new Date().getFullYear()}-${String(filterMonth).padStart(2,"0")}`); const mp=filterPagado==="all"||(filterPagado==="pagado"&&e.pagado)||(filterPagado==="pendiente"&&!e.pagado); const ms=filterSubcat==="all"||e.subcat===filterSubcat; return mc&&mm&&mp&&ms; });
  const exportGastosCSV=()=>{ const rows=[["ID","Foco","Subcategoría","Descripción","Monto","Moneda","Fecha","Vencimiento","Medio de Pago","Estado","Recurrente"]]; filtered.forEach(e=>rows.push([e.id,categories[e.category]?.label,e.subcat,e.desc,fmtRaw(e.amount),e.moneda||"ARS",e.date,e.dueDate,e.medio,e.pagado?"Pagado":"Pendiente",e.recurring?"Sí":"No"])); exportCSV(rows,"gastos_hogar"); };
  const exportGastosPDF=async()=>{ await exportPDF("Listado de Gastos","gastos_hogar","section-gastos"); };
  const exportAnalisisCSV=()=>{ const months=[...new Set(expenses.map(e=>e.date?.slice(0,7)).filter(Boolean))].sort().reverse().slice(0,6); const rows=[["Foco",...months]]; Object.entries(categories).forEach(([k,v])=>{ const rowTotal=months.reduce((s,m)=>s+expenses.filter(e=>e.category===k&&e.date?.startsWith(m)).reduce((a,b)=>a+b.amount,0),0); if(rowTotal) rows.push([v.label,...months.map(m=>fmtRaw(expenses.filter(e=>e.category===k&&e.date?.startsWith(m)).reduce((a,b)=>a+b.amount,0)))]); }); exportCSV(rows,"analisis_hogar"); };
  const exportAnalisisPDF=async()=>{ await exportPDF("Análisis de Gastos","analisis_hogar","section-analisis"); };

  const getDueDates=()=>{ const result={}; expenses.forEach(e=>{ const d=e.dueDate||e.date; if(!d) return; const eYear=parseInt(d.slice(0,4)),eMonth=parseInt(d.slice(5,7))-1; if(eYear!==calYear||eMonth!==calMonth) return; if(!result[d]) result[d]=[]; result[d].push(e); }); return result; };
  const daysInMonth=new Date(calYear,calMonth+1,0).getDate();
  const firstDay=new Date(calYear,calMonth,1).getDay();
  const dueDates=getDueDates();

  if(loadingSession) return <div style={{display:"flex",alignItems:"center",justifyContent:"center",minHeight:"100vh",fontSize:14,color:"#666"}}>Cargando...</div>;
  if(!session) return <Login/>;
  const firstCat=Object.keys(categories)[0];

  return(
    <div style={{fontFamily:"system-ui,sans-serif",maxWidth:960,margin:"0 auto",padding:"1rem",color:"#1a1a1a"}}>
      {showCatEditor&&<CategoryEditor categories={categories} onClose={()=>setShowCatEditor(false)} onSave={cats=>setCategories(cats)}/>}

      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1.5rem",flexWrap:"wrap",gap:8}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:500,margin:0}}>Gastos del Hogar</h1>
          <p style={{fontSize:12,color:"#666",margin:"2px 0 0"}}>{session.user.email}</p>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <input ref={importRef} type="file" accept=".csv" onChange={handleImportCSV} style={{display:"none"}}/>
          <button onClick={()=>importRef.current.click()} style={{fontSize:13,padding:"6px 14px",background:"#f5f5f5",border:"1px solid #ddd",borderRadius:8,cursor:"pointer"}}>↑ CSV</button>
          {importMsg&&<span style={{fontSize:12,color:importMsg.startsWith("✓")?"#1d9e75":"#e24b4a",alignSelf:"center"}}>{importMsg}</span>}
          <button onClick={()=>supabase.auth.signOut()} style={{fontSize:13,padding:"6px 14px",background:"#f5f5f5",border:"1px solid #ddd",borderRadius:8,cursor:"pointer"}}>Salir</button>
          <button onClick={()=>{setShowForm(true);setEditId(null);setAiResult("");setForm({category:firstCat,subcat:categories[firstCat]?.subcats[0]||"",amount:"",moneda:"ARS",date:new Date().toISOString().slice(0,10),desc:"",dueDate:"",recurring:false,fileName:"",medio:medios[0]||"Transferencia",pagado:false});}} style={{fontSize:13,padding:"6px 14px",background:"#3266ad",border:"none",borderRadius:8,cursor:"pointer",color:"#fff",fontWeight:500}}>+ Nuevo Gasto</button>
        </div>
      </div>

      {/* Panel de tipo de cambio — visible siempre */}
      <TipoCambioPanel
        rates={rates}
        onRatesChange={setRates}
        lastUpdated={ratesLastUpdated}
        onRefresh={refreshRates}
        loading={ratesLoading}
      />

      {/* Selector de cotización activa */}
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:"1.5rem",flexWrap:"wrap"}}>
        <span style={{fontSize:12,color:"#666"}}>Cotización para conversión:</span>
        {["oficial","blue","mep","tarjeta"].map(r=>(
          <button key={r} onClick={()=>setActiveRate(r)} style={{fontSize:12,padding:"4px 12px",borderRadius:20,border:`1px solid ${activeRate===r?"#3266ad":"#ddd"}`,background:activeRate===r?"#3266ad":"#fff",color:activeRate===r?"#fff":"#666",cursor:"pointer",fontWeight:activeRate===r?500:400,textTransform:"capitalize"}}>
            {r} {rates[r]>0?`$${fmtRaw(rates[r])}`:""}</button>
        ))}
      </div>

      {/* Nav tabs */}
      <div style={{display:"flex",gap:4,marginBottom:"1.5rem",borderBottom:"1px solid #eee"}}>
        {TABS.map(t=><button key={t} onClick={()=>setTab(t)} style={{padding:"8px 18px",fontSize:14,background:"none",border:"none",borderBottom:tab===t?"2px solid #3266ad":"2px solid transparent",color:tab===t?"#3266ad":"#666",cursor:"pointer",fontWeight:tab===t?500:400}}>{t}</button>)}
      </div>

      {/* Formulario de gasto */}
      {showForm&&(
        <div style={{background:"#fff",border:"1px solid #e0e0e0",borderRadius:12,padding:"1.25rem",marginBottom:"1.5rem"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem"}}>
            <h3 style={{margin:0,fontSize:16,fontWeight:500}}>{editId?"Editar gasto":"Nuevo gasto"}</h3>
            <button onClick={()=>setShowCatEditor(true)} style={{fontSize:12,padding:"4px 12px",background:"#f0f4ff",border:"1px solid #3266ad44",borderRadius:8,cursor:"pointer",color:"#3266ad"}}>⚙ Editar categorías</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            {/* Foco */}
            <div>
              <label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Foco</label>
              <select value={form.category} onChange={e=>setForm(p=>({...p,category:e.target.value,subcat:categories[e.target.value]?.subcats[0]||""}))} style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}>
                {Object.entries(categories).map(([k,v])=><option key={k} value={k}>{v.icon} {v.label}</option>)}
              </select>
            </div>
            {/* Categoría */}
            <div>
              <label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Categoría</label>
              <select value={form.subcat} onChange={e=>setForm(p=>({...p,subcat:e.target.value}))} style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}>
                {(categories[form.category]?.subcats||[]).map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
            {/* Moneda */}
            <div>
              <label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Moneda</label>
              <div style={{display:"flex",gap:6}}>
                {["ARS","USD"].map(m=>(
                  <button key={m} onClick={()=>setForm(p=>({...p,moneda:m}))} style={{flex:1,padding:"7px",borderRadius:8,border:`1px solid ${form.moneda===m?"#3266ad":"#ddd"}`,background:form.moneda===m?"#f0f4ff":"#fff",color:form.moneda===m?"#3266ad":"#666",fontWeight:form.moneda===m?600:400,cursor:"pointer",fontSize:14}}>
                    {m}
                  </button>
                ))}
              </div>
            </div>
            {/* Monto */}
            <div>
              <label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Monto ({form.moneda})</label>
              <input type="number" value={form.amount} onChange={e=>setForm(p=>({...p,amount:e.target.value}))} placeholder="0" style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}/>
            </div>
            {/* Fecha pago */}
            <div>
              <label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Fecha de pago</label>
              <input type="date" value={form.date} onChange={e=>setForm(p=>({...p,date:e.target.value}))} style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}/>
            </div>
            {/* Fecha vencimiento */}
            <div>
              <label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Fecha de vencimiento</label>
              <input type="date" value={form.dueDate} onChange={e=>setForm(p=>({...p,dueDate:e.target.value}))} style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}/>
            </div>
            {/* Descripción */}
            <div>
              <label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Descripción</label>
              <input type="text" value={form.desc} onChange={e=>setForm(p=>({...p,desc:e.target.value}))} placeholder="Ej: Factura Edesur Febrero" style={{width:"100%",padding:"7px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:14,boxSizing:"border-box"}}/>
            </div>
            {/* Medio de pago */}
            <div>
              <label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Medio de pago</label>
              <MedioSelector value={form.medio} onChange={v=>setForm(p=>({...p,medio:v}))} medios={medios} onAddMedio={handleAddMedio}/>
            </div>
            {/* Estado */}
            <div>
              <label style={{fontSize:12,color:"#666",display:"block",marginBottom:4}}>Estado</label>
              <select value={form.pagado?"1":"0"} onChange={e=>setForm(p=>({...p,pagado:e.target.value==="1"}))} style={{width:"100%",padding:"7px 10px",borderRadius:8,border:`1px solid ${form.pagado?"#1d9e75":"#e24b4a"}`,fontSize:14,background:form.pagado?"#f0faf5":"#fef2f2",color:form.pagado?"#0f6e56":"#a32d2d",fontWeight:500,boxSizing:"border-box"}}>
                <option value="0">🔴 Pendiente</option>
                <option value="1">🟢 Pagado</option>
              </select>
            </div>
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

      {/* ── TABS ── */}

      {tab==="Dashboard"&&<Dashboard expenses={expenses} incomes={incomes} categories={categories} rates={rates} activeRate={activeRate}/>}

      {tab==="Gastos"&&(
        <div id="section-gastos">
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"1rem",flexWrap:"wrap",gap:8}}>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <select value={filterCat} onChange={e=>setFilterCat(e.target.value)} style={{padding:"6px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:13}}>
                <option value="all">Todos los focos</option>
                {Object.entries(categories).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
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
              <select value={filterSubcat} onChange={e=>setFilterSubcat(e.target.value)} style={{padding:"6px 10px",borderRadius:8,border:"1px solid #ddd",fontSize:13}}>
                <option value="all">Todas las categorías</option>
                {[...new Set(expenses.map(e=>e.subcat))].sort().map(s=><option key={s}>{s}</option>)}
              </select>
            </div>
            <ExportButtons onCSV={exportGastosCSV} onPDF={exportGastosPDF}/>
          </div>
          {loadingData?<p style={{textAlign:"center",color:"#999",fontSize:14}}>Cargando...</p>
          :filtered.length===0?<div style={{textAlign:"center",padding:"3rem",color:"#999",fontSize:14}}>No hay gastos que coincidan.</div>
          :<div style={{display:"flex",flexDirection:"column",gap:6}}>
            {filtered.sort((a,b)=>b.date?.localeCompare(a.date)).map(e=>{
              const cat=categories[e.category];
              const usd = e.moneda==="USD" ? e.amount : (rates[activeRate]>0 ? e.amount/rates[activeRate] : null);
              return(
                <div key={e.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",background:"#fff",border:`1px solid ${e.pagado?"#1d9e7533":"#e24b4a33"}`,borderLeft:`3px solid ${e.pagado?"#1d9e75":"#e24b4a"}`,borderRadius:8,padding:"10px 14px",gap:8}}>
                  <div style={{display:"flex",alignItems:"center",gap:10,flex:1,minWidth:0}}>
                    <span style={{fontSize:16}}>{cat?.icon}</span>
                    <div style={{minWidth:0}}>
                      <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                        <span style={{fontSize:13,fontWeight:500}}>{e.subcat}</span>
                        <span style={{fontSize:11,padding:"2px 7px",borderRadius:20,background:(cat?.color||"#888")+"22",color:cat?.color||"#888"}}>{cat?.label}</span>
                        <span style={{fontSize:11,padding:"2px 7px",borderRadius:20,background:"#f5f5f5",color:"#666"}}>{e.medio||"—"}</span>
                        <span style={{fontSize:11,padding:"2px 7px",borderRadius:20,background:e.moneda==="USD"?"#3266ad22":"#f5f5f5",color:e.moneda==="USD"?"#185fa5":"#888",fontWeight:e.moneda==="USD"?500:400}}>{e.moneda||"ARS"}</span>
                        {e.recurring&&<span style={{fontSize:11,padding:"2px 7px",borderRadius:20,background:"#3266ad22",color:"#185fa5"}}>Recurrente</span>}
                      </div>
                      <div style={{fontSize:11,color:"#999",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.desc||"—"} · {e.date}{e.dueDate?` · Vence: ${e.dueDate}`:""}</div>
                    </div>
                  </div>
                  <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
                    <div style={{textAlign:"right"}}>
                      <div style={{fontWeight:500,fontSize:14}}>
                        {e.moneda==="USD" ? fmt(e.amount,"USD") : fmt(e.amount,"ARS")}
                      </div>
                      {e.moneda==="ARS" && usd !== null && (
                        <div style={{fontSize:11,color:"#999"}}>{fmt(usd,"USD")}</div>
                      )}
                    </div>
                    <span onClick={()=>togglePagado(e.id)} style={badgeStyle(e.pagado)}>{e.pagado?"✓ Pagado":"● Pendiente"}</span>
                    <button onClick={()=>edit(e)} style={{fontSize:12,padding:"3px 10px",background:"none",border:"1px solid #ddd",borderRadius:8,cursor:"pointer",color:"#666"}}>Editar</button>
                    <button onClick={()=>del(e.id)} style={{fontSize:12,padding:"3px 8px",background:"none",border:"1px solid #ddd",borderRadius:8,cursor:"pointer",color:"#e24b4a"}}>✕</button>
                  </div>
                </div>
              );
            })}
          </div>}
          {filtered.length>0&&<div style={{marginTop:12,textAlign:"right",fontWeight:500,fontSize:14}}>Total: {fmt(filtered.reduce((s,e)=>s+e.amount,0))}</div>}
        </div>
      )}

      {tab==="Ingresos"&&(
        <IngresosTab
          incomes={incomes}
          onAdd={i=>setIncomes(p=>[i,...p])}
          onEdit={i=>setIncomes(p=>p.map(x=>x.id===i.id?{...x,...i}:x))}
          onDelete={id=>setIncomes(p=>p.filter(x=>x.id!==id))}
          medios={medios}
          onAddMedio={handleAddMedio}
          rates={rates}
          activeRate={activeRate}
          incomeCategories={incomeCategories}
          onUpdateIncomeCategories={handleUpdateIncomeCategories}
        />
      )}

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
              const day=i+1;
              const key=`${calYear}-${String(calMonth+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
              const items=dueDates[key]||[];
              const today=new Date();
              const isToday=today.getFullYear()===calYear&&today.getMonth()===calMonth&&today.getDate()===day;
              return(
                <div key={day} style={{minHeight:72,padding:"4px 5px",border:"1px solid #eee",borderRadius:8,background:isToday?"#eff6ff":"#fff"}}>
                  <div style={{fontSize:12,fontWeight:isToday?500:400,color:isToday?"#3266ad":"#999",marginBottom:3}}>{day}</div>
                  {items.map((e,idx)=>(
                    <div key={idx} style={{fontSize:10,padding:"2px 4px",borderRadius:3,background:e.pagado?"#f0faf5":"#fef2f2",color:e.pagado?"#0f6e56":"#a32d2d",border:`1px solid ${e.pagado?"#1d9e7533":"#e24b4a33"}`,marginBottom:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{e.subcat}</div>
                  ))}
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
            <ExportButtons onCSV={exportAnalisisCSV} onPDF={exportAnalisisPDF}/>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
            <div style={{background:"#fff",border:"1px solid #eee",borderRadius:12,padding:"1.25rem"}}>
              <h3 style={{margin:"0 0 1rem",fontSize:15,fontWeight:500}}>Distribución por foco</h3>
              {expenses.length===0?<p style={{fontSize:13,color:"#999"}}>Sin datos.</p>
              :Object.entries(categories).map(([k,v])=>{
                const tot=expenses.filter(e=>e.category===k).reduce((s,e)=>s+e.amount,0);
                const total=expenses.reduce((s,e)=>s+e.amount,0);
                const pct=total>0?Math.round((tot/total)*100):0;
                return(<div key={k} style={{marginBottom:14}}>
                  <div style={{display:"flex",justifyContent:"space-between",fontSize:13,marginBottom:4}}><span>{v.icon} {v.label}</span><span style={{fontWeight:500}}>{fmt(tot)} ({pct}%)</span></div>
                  <div style={{height:8,background:"#f0f0f0",borderRadius:4}}><div style={{height:"100%",width:`${pct}%`,background:v.color,borderRadius:4}}></div></div>
                </div>);
              })}
            </div>
            <div style={{background:"#fff",border:"1px solid #eee",borderRadius:12,padding:"1.25rem"}}>
              <h3 style={{margin:"0 0 4px",fontSize:15,fontWeight:500}}>Resumen por mes</h3>
              <p style={{fontSize:12,color:"#999",margin:"0 0 1rem"}}>Hacé clic en un foco para ver el detalle</p>
              <ExpandableTable expenses={expenses} categories={categories}/>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
