'use client';

import React, { useState, useEffect } from 'react';
import { 
  Box, 
  Layers, 
  Cpu, 
  ShieldCheck, 
  ChevronDown, 
  ChevronRight, 
  Rotate3d, 
  Grid3X3, 
  Maximize, 
  Zap, 
  Database, 
  Clock, 
  Monitor,
  Package,
  Library,
  Printer
} from 'lucide-react';

// --- Types ---
type TechType = 'SLA' | 'FDM';
type Genre = 'Fantasy' | 'Sci-Fi' | 'Anatomy';
type Material = 'Raw' | 'Painted';

// --- Components ---

const CADBackground = () => (
  <div className="fixed inset-0 z-[-1] overflow-hidden bg-[#050505]">
    {/* Technical Grid */}
    <div 
      className="absolute inset-0 opacity-[0.03]" 
      style={{
        backgroundImage: `
          linear-gradient(rgba(255,255,255,1) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px),
          linear-gradient(rgba(255,255,255,0.3) 1px, transparent 1px),
          linear-gradient(90deg, rgba(255,255,255,0.3) 1px, transparent 1px)
        `,
        backgroundSize: '40px 40px, 40px 40px, 10px 10px, 10px 10px'
      }}
    />
    
    {/* Animated Coordinate Markers */}
    <div className="absolute top-8 left-8 font-mono text-[10px] text-white/20">
      <div className="flex gap-2 animate-pulse">
        <span>X: <span className="text-white/40">241.02</span></span>
        <span>Y: <span className="text-white/40">119.54</span></span>
        <span>Z: <span className="text-white/40">0.00</span></span>
      </div>
    </div>
    <div className="absolute bottom-8 right-8 font-mono text-[10px] text-white/20">
      СИСТЕМА_ГОТОВА // СЕТКА_АКТИВНА
    </div>
  </div>
);

const Navigation = () => (
  <nav className="fixed top-0 left-0 right-0 h-16 border-b border-white/[0.05] bg-[#050505]/60 backdrop-blur-xl z-50 px-8 flex items-center justify-between">
    <div className="flex items-center gap-8">
      <div className="text-xl font-bold tracking-tighter flex items-center gap-2">
        <div className="w-6 h-6 bg-white rounded-[4px] flex items-center justify-center">
          <Box size={14} className="text-black" />
        </div>
        STORE-3D
      </div>
      <div className="hidden md:flex gap-6 text-[10px] font-mono uppercase tracking-widest text-white/40">
        <a href="#" className="flex items-center gap-2 hover:text-white transition-colors">
          <Package size={12} /> Магазин_моделей
        </a>
        <a href="#" className="flex items-center gap-2 hover:text-white transition-colors">
          <Library size={12} /> Цифровая_библиотека
        </a>
        <a href="#" className="flex items-center gap-2 hover:text-white transition-colors">
          <Printer size={12} /> Печать_на_заказ
        </a>
      </div>
    </div>
    <div className="flex items-center gap-4">
      <div className="flex items-center gap-2 text-[10px] font-mono text-white/20">
        <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
        СЕРВЕР_СЕВЕР_01
      </div>
      <button className="w-8 h-8 rounded-full border border-white/10 flex items-center justify-center hover:bg-white/5 transition-colors">
        <Monitor size={14} className="text-white/60" />
      </button>
    </div>
  </nav>
);

const Sidebar = () => {
  const [tech, setTech] = useState<TechType>('SLA');
  const [openGenres, setOpenGenres] = useState<Record<string, boolean>>({
    'Fantasy': true,
    'Sci-Fi': false
  });
  const [verified, setVerified] = useState(true);

  const toggleGenre = (genre: string) => {
    setOpenGenres(prev => ({ ...prev, [genre]: !prev[genre] }));
  };

  return (
    <aside className="w-full h-full border-r border-white/[0.05] p-6 space-y-10">
      {/* Tech Filter */}
      <div className="space-y-4">
        <h3 className="text-[10px] font-mono text-white/30 uppercase tracking-[0.2em]">Технологический_стек</h3>
        <div className="grid grid-cols-2 gap-2 p-1 bg-white/[0.03] rounded-lg border border-white/[0.05]">
          <button 
            onClick={() => setTech('SLA')}
            className={`py-2 px-3 rounded-md text-[10px] font-bold transition-all ${tech === 'SLA' ? 'bg-white text-black shadow-lg' : 'text-white/40 hover:text-white'}`}
          >
            SLA СМОЛА
          </button>
          <button 
            onClick={() => setTech('FDM')}
            className={`py-2 px-3 rounded-md text-[10px] font-bold transition-all ${tech === 'FDM' ? 'bg-white text-black shadow-lg' : 'text-white/40 hover:text-white'}`}
          >
            FDM ПЛАСТИК
          </button>
        </div>
      </div>

      {/* Genres */}
      <div className="space-y-4">
        <h3 className="text-[10px] font-mono text-white/30 uppercase tracking-[0.2em]">Жанры_каталога</h3>
        <div className="space-y-2">
          {['Фэнтези', 'Sci-Fi', 'Анатомия'].map((genre) => (
            <div key={genre} className="space-y-1">
              <button 
                onClick={() => toggleGenre(genre)}
                className="w-full flex items-center justify-between py-2 px-3 hover:bg-white/[0.03] rounded-lg transition-colors group"
              >
                <span className="text-xs font-medium text-white/70 group-hover:text-white">{genre}</span>
                {openGenres[genre] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              </button>
              {openGenres[genre] && (
                <div className="pl-6 space-y-1 text-[10px] text-white/40 font-mono">
                  <div className="py-1 hover:text-white cursor-pointer">Миниатюры_v1</div>
                  <div className="py-1 hover:text-white cursor-pointer">Террейн_Объекты</div>
                  <div className="py-1 hover:text-white cursor-pointer">Герои</div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Master Toggle */}
      <div className="pt-6 border-t border-white/[0.05]">
        <div className={`p-4 rounded-xl border transition-all duration-500 ${verified ? 'border-[#D4AF37]/50 bg-[#D4AF37]/5 shadow-[0_0_20px_rgba(212,175,55,0.1)]' : 'border-white/10 bg-white/[0.02]'}`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className={verified ? 'text-[#D4AF37]' : 'text-white/20'} />
              <span className={`text-[10px] font-bold font-mono ${verified ? 'text-[#D4AF37]' : 'text-white/20'}`}>ПРОВЕРЕНО_К_ПЕЧАТИ</span>
            </div>
            <button 
              onClick={() => setVerified(!verified)}
              className={`w-8 h-4 rounded-full relative transition-colors ${verified ? 'bg-[#D4AF37]' : 'bg-white/10'}`}
            >
              <div className={`absolute top-0.5 w-3 h-3 bg-white rounded-full transition-all ${verified ? 'left-4.5' : 'left-0.5'}`} style={{ left: verified ? '18px' : '2px' }} />
            </button>
          </div>
          <p className="text-[9px] text-white/40 leading-relaxed font-mono">Только проверенные модели с просчитанными структурами поддержек.</p>
        </div>
      </div>
    </aside>
  );
};

const VitrineHUD = () => (
  <div className="absolute inset-0 pointer-events-none p-6 flex flex-col justify-between">
    <div className="flex justify-between items-start">
      <div className="bg-black/40 backdrop-blur-md border border-white/10 p-4 rounded-xl flex flex-col gap-3">
        <div className="flex items-center gap-3">
          <Database size={14} className="text-blue-400" />
          <div className="flex flex-col">
            <span className="text-[8px] text-white/30 font-mono">ПОЛИГОНЫ</span>
            <span className="text-[10px] font-mono text-white/80">1,452,900</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Clock size={14} className="text-orange-400" />
          <div className="flex flex-col">
            <span className="text-[8px] text-white/30 font-mono">ВРЕМЯ_ПЕЧАТИ</span>
            <span className="text-[10px] font-mono text-white/80">14ч 22м</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Maximize size={14} className="text-purple-400" />
          <div className="flex flex-col">
            <span className="text-[8px] text-white/30 font-mono">МАСШТАБ</span>
            <span className="text-[10px] font-mono text-white/80">1:1 РЕАЛЬНЫЙ</span>
          </div>
        </div>
      </div>
      <div className="bg-white/5 backdrop-blur-md border border-white/10 px-3 py-1.5 rounded-full flex items-center gap-2">
        <Zap size={10} className="text-[#D4AF37]" />
        <span className="text-[9px] font-mono text-[#D4AF37] font-bold">ПОДДЕРЖКИ_АКТИВНЫ</span>
      </div>
    </div>
    
    <div className="flex justify-between items-end">
      <div className="space-y-2">
        <div className="text-[10px] font-mono text-white/20">ID_МЕША: ARC_V4_88</div>
        <div className="text-4xl font-bold tracking-tighter">АРХАНГЕЛ_MK.IV</div>
      </div>
    </div>
  </div>
);

const Vitrine = () => {
  const [wireframe, setWireframe] = useState(false);
  const [rotate, setRotate] = useState(true);
  const [material, setMaterial] = useState<Material>('Raw');

  return (
    <section className="relative w-full aspect-[16/9] lg:aspect-auto lg:h-[600px] bg-gradient-to-b from-white/[0.02] to-transparent rounded-[32px] border border-white/[0.05] overflow-hidden group">
      {/* Background Effect */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,163,255,0.05)_0%,transparent_70%)] opacity-50" />
      
      {/* 3D Content Simulator */}
      <div className={`absolute inset-0 flex items-center justify-center transition-all duration-700 ${wireframe ? 'opacity-20 scale-95' : 'opacity-100 scale-100'}`}>
        <div className={`relative w-80 h-80 border border-white/10 rounded-full flex items-center justify-center ${rotate ? 'animate-spin-slow' : ''}`}>
           <div className="absolute inset-0 border-t-2 border-blue-500/20 rounded-full" />
           <Box size={120} strokeWidth={0.5} className="text-white/10" />
           <div className="absolute w-full h-full border border-dashed border-white/5 rounded-full rotate-45" />
        </div>
      </div>

      {/* Wireframe Overlay */}
      {wireframe && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className={`w-80 h-80 border-2 border-blue-500/20 rounded-full flex items-center justify-center ${rotate ? 'animate-spin-slow' : ''}`}>
            <Box size={120} strokeWidth={1} className="text-blue-500/40" />
          </div>
        </div>
      )}

      <VitrineHUD />

      {/* Controls */}
      <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-black/60 backdrop-blur-xl p-2 rounded-2xl border border-white/10 pointer-events-auto">
        <button 
          onClick={() => setRotate(!rotate)}
          className={`p-2.5 rounded-xl transition-all ${rotate ? 'bg-white text-black' : 'text-white/60 hover:text-white hover:bg-white/5'}`}
        >
          <Rotate3d size={18} />
        </button>
        <button 
          onClick={() => setWireframe(!wireframe)}
          className={`p-2.5 rounded-xl transition-all ${wireframe ? 'bg-white text-black' : 'text-white/60 hover:text-white hover:bg-white/5'}`}
        >
          <Grid3X3 size={18} />
        </button>
        <div className="h-6 w-[1px] bg-white/10 mx-1" />
        <div className="flex bg-white/5 rounded-xl p-1">
          <button 
            onClick={() => setMaterial('Raw')}
            className={`px-4 py-1.5 rounded-lg text-[10px] font-bold transition-all ${material === 'Raw' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
          >
            БАЗОВЫЙ_СЕРЫЙ
          </button>
          <button 
            onClick={() => setMaterial('Painted')}
            className={`px-4 py-1.5 rounded-lg text-[10px] font-bold transition-all ${material === 'Painted' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
          >
            ПРО_ПОКРАС
          </button>
        </div>
      </div>
    </section>
  );
};

const FeedCard = ({ id, title, price, tech, verified }: { id: string, title: string, price: string, tech: string, verified?: boolean }) => (
  <div className="group bg-white/[0.02] border border-white/[0.05] rounded-3xl p-4 transition-all hover:bg-white/[0.04] hover:border-white/10">
    <div className="aspect-square bg-white/[0.02] rounded-2xl mb-4 relative overflow-hidden flex items-center justify-center">
      <Box size={40} strokeWidth={0.5} className="text-white/10 group-hover:scale-110 transition-transform duration-500" />
      {verified && <div className="absolute top-3 right-3 text-[#D4AF37]"><ShieldCheck size={14} /></div>}
    </div>
    <div className="space-y-1">
      <div className="flex justify-between items-start">
        <span className="text-[8px] font-mono text-white/20 uppercase">{tech} // {id}</span>
        <span className="text-xs font-bold text-white/80">{price}</span>
      </div>
      <h4 className="text-sm font-bold tracking-tight uppercase group-hover:text-blue-400 transition-colors">{title}</h4>
    </div>
  </div>
);

export default function Store3D() {
  return (
    <div className="min-h-screen text-white font-sans selection:bg-blue-500/30">
      <CADBackground />
      <Navigation />
      
      <main className="pt-24 pb-12 px-8 max-w-[1600px] mx-auto flex flex-col lg:flex-row gap-8">
        {/* Sidebar - 20% (approx) */}
        <div className="lg:w-[320px] flex-shrink-0">
          <div className="sticky top-24">
            <Sidebar />
          </div>
        </div>

        {/* Content - 80% (approx) */}
        <div className="flex-grow space-y-12">
          <Vitrine />
          
          <div className="space-y-8">
            <div className="flex justify-between items-end border-b border-white/[0.05] pb-6">
              <div>
                <h2 className="text-2xl font-bold tracking-tighter uppercase">Коллекция_Хранилища</h2>
                <p className="text-xs text-white/30 font-mono mt-1">ОТОБРАННЫЕ_ИНЖЕНЕРНЫЕ_МЕШИ</p>
              </div>
              <div className="flex gap-4 mono text-[10px] text-white/40">
                <span>ВСЕГО: 1,244</span>
                <span className="text-white/10">|</span>
                <span className="text-white">ОТФИЛЬТРОВАНО: 42</span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
              <FeedCard id="#0041" title="Странник Бездны" price="$14.00" tech="SLA_RESIN" verified />
              <FeedCard id="#0812" title="Промышленная Шестерня" price="$8.00" tech="FDM_PLASTIC" />
              <FeedCard id="#9921" title="Кибер Они" price="$22.00" tech="SLA_RESIN" verified />
              <FeedCard id="#4401" title="Модульная База" price="$10.00" tech="FDM_PLASTIC" verified />
            </div>
          </div>
        </div>
      </main>

      <style jsx global>{`
        @keyframes spin-slow {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
        .animate-spin-slow {
          animation: spin-slow 12s linear infinite;
        }
        
        /* Thin borders */
        .border {
          border-width: 0.5px;
        }
        .border-b {
          border-bottom-width: 0.5px;
        }
        .border-r {
          border-right-width: 0.5px;
        }
        .border-t {
          border-top-width: 0.5px;
        }
      `}</style>
    </div>
  );
}
