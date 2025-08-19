import React, { useEffect, useMemo, useState } from 'react'
import { initializeApp } from 'firebase/app'
import {
  getFirestore, collection, onSnapshot, addDoc, serverTimestamp,
  query, where, doc, deleteDoc, updateDoc, setDoc
} from 'firebase/firestore';
import {
  DollarSign, Truck, Plus, Trash2, Edit, Save, X, Briefcase,
  ChevronLeft, ChevronRight, Printer, Search,
  History as HistoryIcon, Upload,
  Settings as SettingsIcon, RotateCcw, CheckCircle2 as CheckCircle2Icon
} from 'lucide-react';

const firebaseConfigStr = import.meta.env.VITE_FIREBASE_CONFIG;
const firebaseConfig = typeof firebaseConfigStr === 'string' ? JSON.parse(firebaseConfigStr) : firebaseConfigStr;
const __app_id = import.meta.env.VITE_APP_ID || 'business-manager';

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const Views = {
  TRANSACTIONS: 'transactions',
  RETURNS: 'returns',
  HISTORY: 'history',
  SETTINGS: 'settings'
};

const startOfWeek = (date) => {
  const d = new Date(date);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diff = (day === 0 ? -6 : 1) - day; // back to Monday
  d.setDate(d.getDate() + diff);
  d.setHours(0,0,0,0);
  return d;
};
const endOfWeek = (date) => {
  const d = startOfWeek(date);
  d.setDate(d.getDate() + 7);
  return d;
};

function formatCurrencyCZ0(n){
  return Number(n||0).toLocaleString('cs-CZ',{minimumFractionDigits:0,maximumFractionDigits:0});
}
function formatPhone(raw=''){
  const s = String(raw).replace(/\D+/g,'');
  if(!s) return '';
  if(s.startsWith('420') && s.length>=12){
    const rest = s.slice(3);
    return '+420 ' + rest.replace(/(\d{3})(?=\d)/g,'$1 ').trim();
  }
  return s.replace(/(\d{3})(?=\d)/g,'$1 ').trim();
}

export default function App(){
  const [currentView, setCurrentView] = useState(Views.TRANSACTIONS);
  const [transactions, setTransactions] = useState([]);
  const [returnsList, setReturnsList] = useState([]);
  const [history, setHistory] = useState([]);
  const [exchangeRate, setExchangeRate] = useState(6.0); // PLN->CZK default, can be overridden by settings
  const [weekOffset, setWeekOffset] = useState(0);
  const [searchTerm, setSearchTerm] = useState('');

  // Live subscriptions
  useEffect(() => {
    const unsubTx = onSnapshot(
      query(collection(db, `/artifacts/${__app_id}/public/data/transactions`)),
      snap => setTransactions(snap.docs.map(d=>({id:d.id, ...d.data()}))),
      e => console.error('tx snapshot err', e)
    );
    const unsubReturns = onSnapshot(
      query(collection(db, `/artifacts/${__app_id}/public/data/returns`)),
      snap => setReturnsList(snap.docs.map(d=>({id:d.id, ...d.data()}))),
      e => console.error('returns snapshot err', e)
    );
    const unsubHist = onSnapshot(
      query(collection(db, `/artifacts/${__app_id}/public/data/history`)),
      snap => setHistory(snap.docs.map(d=>({id:d.id, ...d.data()}))),
      e => console.error('history snapshot err', e)
    );
    const unsubSettings = onSnapshot(
      query(collection(db, `/artifacts/${__app_id}/public/data/settings`)),
      snap => {
        const s = snap.docs.map(d=>d.data());
        const rate = s.find(x=>x.key==='plnToCzk');
        if(rate?.value) setExchangeRate(parseFloat(rate.value));
      },
      e => console.error('settings snapshot err', e)
    );
    return () => { unsubTx?.(); unsubReturns?.(); unsubHist?.(); unsubSettings?.(); }
  }, []);

  const targetWeekStart = useMemo(()=>{
    const base = startOfWeek(new Date());
    const d = new Date(base);
    d.setDate(d.getDate() + weekOffset*7);
    return d;
  }, [weekOffset]);
  const targetWeekEnd = useMemo(()=> endOfWeek(targetWeekStart), [targetWeekStart]);

  // Filter for current week + search
  const filteredTransactions = useMemo(()=>{
    return transactions.filter(t => {
      let d = t.saleDate ? new Date(t.saleDate) : (t.createdAt?.toDate ? t.createdAt.toDate() : null);
      if(!d) return false;
      return d >= targetWeekStart && d < targetWeekEnd;
    }).filter(t => {
      const q = (searchTerm||'').toLowerCase();
      if(!q) return true;
      return [
        t.itemName, t.brand, t.model, t.customerName, t.customerAddress, t.seller, t.supplier, t.note
      ].some(x=>String(x||'').toLowerCase().includes(q));
    }).sort((a,b)=>{
      const da = a.saleDate ? new Date(a.saleDate).getTime() : 0;
      const dbb = b.saleDate ? new Date(b.saleDate).getTime() : 0;
      return dbb - da; // newest first
    });
  }, [transactions, targetWeekStart, targetWeekEnd, searchTerm]);

  const weekLabel = useMemo(()=>{
    const opts = { day:'2-digit', month:'2-digit', year:'numeric' };
    const start = targetWeekStart.toLocaleDateString('cs-CZ',opts);
    const end = new Date(targetWeekEnd.getTime()-1).toLocaleDateString('cs-CZ',opts);
    return `${start} – ${end}`;
  }, [targetWeekStart, targetWeekEnd]);

  const summary = useMemo(()=>{
    const purchase = filteredTransactions.reduce((s,t)=> s + Number(t.purchasePricePln||0)*Number(exchangeRate||0),0);
    const selling  = filteredTransactions.reduce((s,t)=> s + Number(t.sellingPriceCzk||0),0);
    const profit   = filteredTransactions.reduce((s,t)=> s + Number(t.netProfitCzk|| (Number(t.sellingPriceCzk||0) - Number(t.purchasePricePln||0)*Number(exchangeRate||0))),0);
    return { purchase, selling, profit, count: filteredTransactions.length };
  }, [filteredTransactions, exchangeRate]);

  async function handleAddToReturns(item){
    try{
      await setDoc(
        doc(db, `/artifacts/${__app_id}/public/data/returns`, item.id),
        {
          transactionId: item.id,
          itemName: item.itemName || '',
          note: item.note || '',
          seller: item.seller || '',
          sellingPriceCzk: Number(item.sellingPriceCzk || 0),
          deliveryCity: item.deliveryCity || '',
          customerAddress: item.customerAddress || '',
          customerContact: item.customerContact || '',
          customerPhone2: item.customerPhone2 || '',
          depositCzk: Number(item.depositCzk || 0),
          returned: Boolean(item.returned || false),
          createdAt: serverTimestamp()
        },
        { merge: true }
      );
      await addDoc(
        collection(db, `/artifacts/${__app_id}/public/data/history`),
        {
          action: 'Přidáno do vrácení',
          docId: item.id,
          details: `Položka '${item.itemName}' přidána do Vrácení starých motorů.`,
          timestamp: serverTimestamp(),
        }
      );
      alert('Přidáno do sekce Vrácení');
    }catch(e){
      console.error('Add to returns failed', e);
      alert('Chyba při přidávání do vrácení');
    }
  }

  function TransactionsView(){
    return (
      <div className="card">
        <div className="header">
          <h2 className="text-2xl">Prodeje – týden {weekLabel}</h2>
          <div style={{marginLeft:'auto', display:'flex', gap:8}}>
            <button onClick={()=>setWeekOffset(o=>o-1)}><ChevronLeft size={16}/> Předchozí</button>
            <button onClick={()=>setWeekOffset(0)}>Dnes</button>
            <button onClick={()=>setWeekOffset(o=>o+1)}>Další <ChevronRight size={16}/></button>
          </div>
        </div>

        {/* Souhrn */}
        <div className="grid summary" style={{display:'grid',gridTemplateColumns:'repeat(4,minmax(0,1fr))',gap:12, marginBottom:12}}>
          <div className="card"><div>Nákup (CZK)</div><h4>{formatCurrencyCZ0(summary.purchase)}</h4></div>
          <div className="card"><div>Prodej (CZK)</div><h4>{formatCurrencyCZ0(summary.selling)}</h4></div>
          <div className="card"><div>Čistý zisk (CZK)</div><h4>{formatCurrencyCZ0(summary.profit)}</h4></div>
          <div className="card"><div>Počet záznamů</div><h4>{summary.count}</h4></div>
        </div>

        <div style={{marginBottom:12}}>
          <input value={searchTerm} onChange={e=>setSearchTerm(e.target.value)} placeholder="Hledat (položka, zákazník, značka…)" style={{width:'100%'}}/>
        </div>

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Datum prodeje</th>
                <th>Položka</th>
                <th>Značka</th>
                <th>Model</th>
                <th>Poznámka</th>
                <th>Prodejce</th>
                <th>Dodavatel</th>
                <th>Nákup (CZK)</th>
                <th>Prodej (CZK)</th>
                <th>Zisk</th>
                <th>Město</th>
                <th>Adresa zákazníka</th>
                <th>Zák. Tel.</th>
                <th>Akce</th>
                <th>Vrátit</th>
              </tr>
            </thead>
            <tbody>
              {filteredTransactions.map(item => {
                const purchaseCzk = Number(item.purchasePricePln||0)*Number(exchangeRate||0);
                const profit = Number(item.netProfitCzk ?? (Number(item.sellingPriceCzk||0)-purchaseCzk));
                const saleDate = item.saleDate ? new Date(item.saleDate) : (item.createdAt?.toDate ? item.createdAt.toDate() : null);
                return (
                  <tr key={item.id}>
                    <td>{saleDate ? saleDate.toLocaleDateString('cs-CZ') : '-'}</td>
                    <td>{item.itemName||'-'}</td>
                    <td>{item.brand||'-'}</td>
                    <td>{item.model||'-'}</td>
                    <td>{item.note||'-'}</td>
                    <td>{item.seller||'-'}</td>
                    <td>{item.supplier||'-'}</td>
                    <td>{formatCurrencyCZ0(purchaseCzk)}</td>
                    <td>{formatCurrencyCZ0(item.sellingPriceCzk)}</td>
                    <td>{formatCurrencyCZ0(profit)}</td>
                    <td>{item.deliveryCity||'-'}</td>
                    <td>{item.customerAddress||'-'}</td>
                    <td>
                      <div>{formatPhone(item.customerContact)}</div>
                      {item.customerPhone2 ? <div style={{opacity:.8,fontSize:'0.9em'}}>{formatPhone(item.customerPhone2)}</div> : null}
                    </td>
                    <td className="actions">
                      <button title="Edit"><Edit size={16}/></button>
                      <button title="Smazat"><Trash2 size={16}/></button>
                    </td>
                    <td>
                      <button onClick={()=>handleAddToReturns(item)} title="Přidat do vrácení"><RotateCcw size={16}/></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  function ReturnsView(){
    const filteredReturns = useMemo(()=>{
      return returnsList.filter(r => {
        const d = r.createdAt?.toDate ? r.createdAt.toDate() : (r.saleDate ? new Date(r.saleDate) : null);
        if(!d) return false;
        return d >= targetWeekStart && d < targetWeekEnd;
      }).sort((a,b)=>{
        const da = a.createdAt?.toDate ? a.createdAt.toDate().getTime() : 0;
        const dbb = b.createdAt?.toDate ? b.createdAt.toDate().getTime() : 0;
        return dbb - da;
      });
    }, [returnsList, targetWeekStart, targetWeekEnd]);

    const returnedCount = filteredReturns.filter(r=>r.returned).length;

    async function toggleReturned(row){
      try{
        await updateDoc(doc(db, `/artifacts/${__app_id}/public/data/returns`, row.id), {
          returned: !row.returned,
          returnedAt: !row.returned ? serverTimestamp() : null
        });
      }catch(e){
        console.error('toggle returned err', e);
      }
    }

    async function saveDeposit(row, value){
      try{
        const num = Number((value||'').toString().replace(',', '.'));
        await updateDoc(doc(db, `/artifacts/${__app_id}/public/data/returns`, row.id), {
          depositCzk: isNaN(num) ? 0 : num
        });
      }catch(e){
        console.error('save deposit err', e);
      }
    }

    return (
      <div className="card">
        <div className="header">
          <h2 className="text-2xl">Vrácení starých motorů – týden {weekLabel}</h2>
          <div style={{marginLeft:'auto', display:'flex', gap:8}}>
            <button onClick={()=>setWeekOffset(o=>o-1)}><ChevronLeft size={16}/> Předchozí</button>
            <button onClick={()=>setWeekOffset(0)}>Dnes</button>
            <button onClick={()=>setWeekOffset(o=>o+1)}>Další <ChevronRight size={16}/></button>
          </div>
        </div>

        {/* Counter */}
        <div className="grid" style={{gridTemplateColumns:'repeat(3,minmax(0,1fr))', gap:12, marginBottom:12}}>
          <div className="card"><div>Počet v týdnu</div><h4>{filteredReturns.length}</h4></div>
          <div className="card"><div>Vráceno</div><h4>{returnedCount}</h4></div>
          <div className="card"><div>Zbývá vrátit</div><h4>{filteredReturns.length - returnedCount}</h4></div>
        </div>

        <div className="overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th>Položka</th>
                <th>Poznámka</th>
                <th>Prodej (Kč)</th>
                <th>Město</th>
                <th>Adresa</th>
                <th>Telefon</th>
                <th>Záloha (Kč)</th>
                <th>Stav</th>
              </tr>
            </thead>
            <tbody>
              {filteredReturns.map(row => (
                <tr key={row.id} style={{background: row.returned ? '#dcfce7' : 'transparent'}}>
                  <td>{row.itemName||'-'}</td>
                  <td>{row.note||'-'}</td>
                  <td>{formatCurrencyCZ0(row.sellingPriceCzk)}</td>
                  <td>{row.deliveryCity||'-'}</td>
                  <td>{row.customerAddress||'-'}</td>
                  <td>
                    <div>{formatPhone(row.customerContact)}</div>
                    {row.customerPhone2 ? <div style={{opacity:.8,fontSize:'0.9em'}}>{formatPhone(row.customerPhone2)}</div> : null}
                  </td>
                  <td>
                    <input
                      defaultValue={row.depositCzk ?? 0}
                      onBlur={(e)=>saveDeposit(row, e.target.value)}
                      style={{width:120}}
                    />
                  </td>
                  <td>
                    <button onClick={()=>toggleReturned(row)} className={'badge ' + (row.returned?'badge-green':'badge-red')}>
                      {row.returned ? 'Vráceno' : 'Nesplněno'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    )
  }

  return (
    <div className="container">
      <nav style={{display:'flex', gap:8, marginBottom:16}}>
        <button className={currentView===Views.TRANSACTIONS?'active':''} onClick={()=>setCurrentView(Views.TRANSACTIONS)}>Prodeje</button>
        <button className={currentView===Views.RETURNS?'active':''} onClick={()=>setCurrentView(Views.RETURNS)}>Vrácení</button>
      </nav>

      {currentView===Views.TRANSACTIONS && <TransactionsView/>}
      {currentView===Views.RETURNS && <ReturnsView/>}
    </div>
  )
}
