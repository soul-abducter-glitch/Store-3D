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
  <div className="fixed inset-0 z-[-1] overflow-hidden bg-[#030303] rim-light">
    {/* Technical Grid */}
    <div className="absolute inset-0 opacity-[0.05] cad-grid-pattern" />
    
    {/* Animated Coordinate Markers */}
    <div className="absolute top-8 left-8 font-mono text-[10px] text-white/20">
      <div className="flex gap-2">
        <span>X: <span className="text-white/40 animate-pulse">241.02</span></span>
        <span>Y: <span className="text-white/40 animate-pulse" style={{ animationDelay: '1s' }}>119.54</span></span>
        <span>Z: <span className="text-white/40">0.00</span></span>
      </div>
    </div>
    <div className="absolute top-1/2 left-4 -translate-y-1/2 font-mono text-[8px] text-white/10 [writing-mode:vertical-lr] tracking-widest uppercase">
      Grid_Scale_System_v2.0
    </div>
    <div className="absolute bottom-8 right-8 font-mono text-[10px] text-white/20">
      СИСТЕМА_ГОТОВА // СЕТКА_АКТИВНА
    </div>
  </div>
);

const Navigation = () => (
  <nav className="fixed top-0 left-0 right-0 h-16 border-b border-white/[0.05] glass-dock z-50 px-8 flex items-center justify-between">
    <div className="flex items-center gap-8">
      <div className="text-xl font-bold tracking-tighter flex items-center gap-2">
        <div className="w-6 h-6 bg-white rounded-[4px] flex items-center justify-center">
          <Box size={14} className="text-black" />
        </div>
        3D-STORE
      </div>
      <div className="hidden md:flex gap-6 text-[10px] font-mono uppercase tracking-widest text-white/40">
        <a href="#" className="flex items-center gap-2 hover:text-white transition-colors">
          <Package size={12} /> Магазин
        </a>
        <a href="#" className="flex items-center gap-2 hover:text-white transition-colors">
          <Library size={12} /> Библиотека
        </a>
        <a href="#" className="flex items-center gap-2 hover:text-white transition-colors">
          <Printer size={12} /> Печать
        </a>
      </div>
    </div>
    <div className="flex items-center gap-6">
      <div className="flex items-center gap-2 text-[10px] font-mono text-white/20">
        <span className="w-1.5 h-1.5 bg-cyber-blue rounded-full animate-pulse" />
        SVR_LAB_01
      </div>
      <div className="w-8 h-8 rounded-full bg-white/5 border border-white/10 flex items-center justify-center hover:bg-white/10 transition-colors cursor-pointer">
        <Monitor size={14} className="text-white/60" />
      </div>
    </div>
  </nav>
);

const Sidebar = () => {
  const [tech, setTech] = useState<TechType>('SLA');
  const [format, setFormat] = useState<'Digital' | 'Physical'>('Digital');
  const [finish, setFinish] = useState<'Raw' | 'Painted'>('Raw');
  const [verified, setVerified] = useState(true);
  const [openCategories, setOpenCategories] = useState<Record<string, boolean>>({
    'Characters & People': true
  });

  const toggleCategory = (cat: string) => {
    setOpenCategories(prev => ({ ...prev, [cat]: !prev[cat] }));
  };

  const taxonomy = [
    {
      name: 'Characters & People',
      sub: [
        { name: 'Male', count: 42 },
        { name: 'Female', count: 38 },
        { name: 'Stylized/Anime', count: 25 },
        { name: 'Fantasy Races', count: 56 }
      ]
    },
    {
      name: 'Tabletop & Gaming',
      sub: [
        { name: 'Monsters', count: 89 },
        { name: 'Scenery', count: 45 },
        { name: 'Gaming Accessories', count: 12 },
        { name: 'Miniatures', count: 134 }
      ]
    },
    {
      name: 'Home & Decor',
      sub: [
        { name: 'Vases & Planters', count: 22 },
        { name: 'Lighting', count: 15 },
        { name: 'Organizers', count: 31 },
        { name: 'Wall Art', count: 19 }
      ]
    },
    {
      name: 'Architecture',
      sub: [
        { name: 'Buildings', count: 28 },
        { name: 'Landmarks', count: 14 },
        { name: 'Diorama elements', count: 37 }
      ]
    },
    {
      name: 'Hobby & Toys',
      sub: [
        { name: 'Articulated/Flexi', count: 64 },
        { name: 'Cosplay Props', count: 21 },
        { name: 'Masks', count: 18 }
      ]
    }
  ];

  return (
    <aside className="w-full h-full border-r border-white/[0.05] p-6 space-y-8">
      {/* Technology Filter */}
      <div className="space-y-3">
        <h3 className="text-[9px] font-mono text-white/20 uppercase tracking-[0.2em]">Technology_Stack</h3>
        <div className="flex bg-white/[0.03] rounded-xl p-1 border border-white/[0.05]">
          <button 
            onClick={() => setTech('SLA')}
            className={`flex-1 py-2 rounded-lg text-[10px] font-bold transition-all ${tech === 'SLA' ? 'bg-white text-black shadow-lg' : 'text-white/40 hover:text-white'}`}
          >
            SLA RESIN
          </button>
          <button 
            onClick={() => setTech('FDM')}
            className={`flex-1 py-2 rounded-lg text-[10px] font-bold transition-all ${tech === 'FDM' ? 'bg-white text-black shadow-lg' : 'text-white/40 hover:text-white'}`}
          >
            FDM PLASTIC
          </button>
        </div>
      </div>

      {/* Product Format */}
      <div className="space-y-3">
        <h3 className="text-[9px] font-mono text-white/20 uppercase tracking-[0.2em]">Product_Format</h3>
        <div className="flex bg-white/[0.03] rounded-xl p-1 border border-white/[0.05]">
          <button 
            onClick={() => setFormat('Digital')}
            className={`flex-1 py-2 rounded-lg text-[10px] font-bold transition-all ${format === 'Digital' ? 'bg-cyber-blue text-white shadow-lg' : 'text-white/40 hover:text-white'}`}
          >
            DIGITAL STL
          </button>
          <button 
            onClick={() => setFormat('Physical')}
            className={`flex-1 py-2 rounded-lg text-[10px] font-bold transition-all ${format === 'Physical' ? 'bg-cyber-blue text-white shadow-lg' : 'text-white/40 hover:text-white'}`}
          >
            PHYSICAL
          </button>
        </div>
      </div>

      {/* Finish Selector (Only for Physical) */}
      <div className={`space-y-3 transition-all duration-500 overflow-hidden ${format === 'Physical' ? 'max-h-24 opacity-100' : 'max-h-0 opacity-0'}`}>
        <h3 className="text-[9px] font-mono text-white/20 uppercase tracking-[0.2em]">Finish_Type</h3>
        <div className="flex bg-white/[0.03] rounded-xl p-1 border border-white/[0.05]">
          <button 
            onClick={() => setFinish('Raw')}
            className={`flex-1 py-2 rounded-lg text-[10px] font-bold transition-all ${finish === 'Raw' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
          >
            RAW_BASE
          </button>
          <button 
            onClick={() => setFinish('Painted')}
            className={`flex-1 py-2 rounded-lg text-[10px] font-bold transition-all ${finish === 'Painted' ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white'}`}
          >
            PRO_PAINTED
          </button>
        </div>
      </div>

      {/* Master Toggle */}
      <div className="pt-2">
        <div className={`p-4 rounded-2xl border transition-all duration-500 ${verified ? 'border-gold/50 bg-gold/5 shadow-[0_0_15px_rgba(212,175,55,0.3)]' : 'border-white/10 bg-white/[0.02]'}`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <ShieldCheck size={16} className={verified ? 'text-gold' : 'text-white/20'} />
              <span className={`text-[10px] font-bold font-mono ${verified ? 'text-gold' : 'text-white/20'}`}>VERIFIED_READY</span>
            </div>
            <button 
              onClick={() => setVerified(!verified)}
              className={`w-9 h-5 rounded-full relative transition-all duration-300 ${verified ? 'bg-gold' : 'bg-white/10'}`}
            >
              <div className={`absolute top-1 w-3 h-3 bg-white rounded-full transition-all duration-300 ${verified ? 'left-5' : 'left-1'}`} />
            </button>
          </div>
          <p className="text-[8px] text-white/30 font-mono uppercase tracking-tighter">Gold_Standard_Engineering</p>
        </div>
      </div>

      <div className="h-[1px] bg-white/5" />

      {/* Catalog Taxonomy */}
      <div className="space-y-4">
        <h3 className="text-[9px] font-mono text-white/20 uppercase tracking-[0.2em]">Catalog_Taxonomy</h3>
        <div className="space-y-1">
          {taxonomy.map((category) => (
            <div key={category.name} className="space-y-1">
              <button 
                onClick={() => toggleCategory(category.name)}
                className="w-full flex items-center justify-between py-2.5 px-3 hover:bg-white/[0.03] rounded-xl transition-all group"
              >
                <span className="text-xs font-bold text-white/80 group-hover:text-white tracking-tight">{category.name}</span>
                {openCategories[category.name] ? 
                  <ChevronDown size={14} className="text-white/20" /> : 
                  <ChevronRight size={14} className="text-white/20" />
                }
              </button>
              {openCategories[category.name] && (
                <div className="pl-6 pb-2 space-y-1">
                  {category.sub.map(sub => (
                    <div key={sub.name} className="flex justify-between items-center py-1.5 px-3 rounded-lg hover:bg-white/[0.02] cursor-pointer group/item">
                      <span className="text-[11px] text-white/40 group-hover/item:text-cyber-blue transition-colors">{sub.name}</span>
                      <span className="font-mono text-[9px] text-white/10 group-hover/item:text-white/30 tracking-widest">[{sub.count}]</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
};

const VitrineHUD = () => (
  <div className="absolute inset-0 pointer-events-none p-10 flex flex-col justify-between font-mono">
    <div className="flex justify-between items-start">
      <div className="bg-black/60 backdrop-blur-2xl border border-white/5 p-6 rounded-[24px] flex flex-col gap-5 inner-depth">
        <div className="flex items-center gap-4">
          <Database size={16} className="text-cyber-blue" />
          <div className="flex flex-col">
            <span className="text-[9px] text-white/20 uppercase tracking-widest">Polygons</span>
            <span className="text-[12px] font-bold text-white/90">2,452,900</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Clock size={16} className="text-gold" />
          <div className="flex flex-col">
            <span className="text-[9px] text-white/20 uppercase tracking-widest">Print_Time</span>
            <span className="text-[12px] font-bold text-white/90">14h 22m</span>
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Maximize size={16} className="text-white/40" />
          <div className="flex flex-col">
            <span className="text-[9px] text-white/20 uppercase tracking-widest">Scale</span>
            <span className="text-[12px] font-bold text-white/90">1:1 REAL</span>
          </div>
        </div>
      </div>
      <div className="bg-gold/10 backdrop-blur-xl border border-gold/20 px-4 py-2 rounded-full flex items-center gap-2 shadow-[0_0_20px_rgba(212,175,55,0.1)]">
        <div className="w-1.5 h-1.5 bg-gold rounded-full animate-pulse" />
        <span className="text-[10px] text-gold font-bold tracking-tighter">VERIFIED_PRINT_READY</span>
      </div>
    </div>
    
    <div className="flex justify-between items-end">
      <div className="space-y-3">
        <div className="text-[10px] text-white/20 tracking-[0.3em] uppercase">Tech_ID: ARC_V4_88</div>
        <div className="text-5xl font-bold tracking-tighter text-white font-sans">ARCHANGEL MK.IV</div>
      </div>
    </div>
  </div>
);

const Vitrine = () => {
  const [wireframe, setWireframe] = useState(false);
  const [rotate, setRotate] = useState(true);
  const [material, setMaterial] = useState<Material>('Raw');

  return (
    <section className="relative w-full aspect-[16/9] lg:aspect-auto lg:h-[650px] bg-white/[0.01] rounded-[48px] inner-depth overflow-hidden group">
      {/* Background Effect */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(0,163,255,0.08)_0%,transparent_70%)] opacity-50" />
      
      {/* 3D Content Simulator */}
      <div className={`absolute inset-0 flex items-center justify-center transition-all duration-1000 cubic-bezier(0.16, 1, 0.3, 1) ${wireframe ? 'opacity-20 scale-90 blur-sm' : 'opacity-100 scale-100'}`}>
        <div className={`relative w-96 h-96 flex items-center justify-center ${rotate ? 'animate-spin-slow' : ''}`}>
           <div className="absolute inset-0 border-[0.5px] border-white/5 rounded-full" />
           <div className="absolute inset-8 border-[0.5px] border-cyber-blue/10 rounded-full animate-pulse" />
           <Box size={160} strokeWidth={0.3} className="text-white/10 animate-float" />
           
           {/* Axis markers inside 3D space */}
           <div className="absolute -top-4 left-1/2 -translate-x-1/2 font-mono text-[8px] text-white/20">Y_AXIS</div>
           <div className="absolute top-1/2 -right-12 -translate-y-1/2 font-mono text-[8px] text-white/20 rotate-90">X_AXIS</div>
        </div>
      </div>

      {/* Wireframe Overlay */}
      {wireframe && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className={`w-96 h-96 border-[0.5px] border-cyber-blue/30 rounded-full flex items-center justify-center ${rotate ? 'animate-spin-slow' : ''}`}>
            <Box size={160} strokeWidth={0.8} className="text-cyber-blue/40 shadow-[0_0_30px_rgba(0,163,255,0.2)]" />
          </div>
        </div>
      )}

      <VitrineHUD />

      {/* Glassmorphism Dock */}
      <div className="absolute bottom-10 left-1/2 -translate-x-1/2 flex items-center gap-4 glass-dock p-2 rounded-3xl pointer-events-auto">
        <div className="flex gap-1">
          <button 
            onClick={() => setRotate(!rotate)}
            className={`p-3 rounded-2xl transition-all duration-300 ${rotate ? 'bg-white text-black shadow-xl' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
            title="360 Rotation"
          >
            <Rotate3d size={20} />
          </button>
          <button 
            onClick={() => setWireframe(!wireframe)}
            className={`p-3 rounded-2xl transition-all duration-300 ${wireframe ? 'bg-white text-black shadow-xl' : 'text-white/40 hover:text-white hover:bg-white/5'}`}
            title="Wireframe Mode"
          >
            <Grid3X3 size={20} />
          </button>
          <button className="p-3 rounded-2xl text-white/40 hover:text-white hover:bg-white/5 transition-all duration-300" title="AR Preview">
            <Maximize size={20} />
          </button>
        </div>
        
        <div className="h-8 w-[0.5px] bg-white/10 mx-1" />
        
        <div className="flex bg-black/20 rounded-2xl p-1 border border-white/5">
          <button 
            onClick={() => setMaterial('Raw')}
            className={`px-5 py-2 rounded-xl text-[10px] font-bold tracking-widest transition-all duration-300 ${material === 'Raw' ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white'}`}
          >
            RAW_BASE
          </button>
          <button 
            onClick={() => setMaterial('Painted')}
            className={`px-5 py-2 rounded-xl text-[10px] font-bold tracking-widest transition-all duration-300 ${material === 'Painted' ? 'bg-white/10 text-white' : 'text-white/30 hover:text-white'}`}
          >
            PRO_PAINTED
          </button>
        </div>
      </div>
    </section>
  );
};

const FeedCard = ({ id, title, price, tech, verified }: { id: string, title: string, price: string, tech: string, verified?: boolean }) => (
  <div className="group bg-white/[0.01] rounded-3xl p-6 transition-all hover:bg-white/[0.04] light-sweep inner-depth cursor-pointer hover:-translate-y-1 duration-500">
    <div className="aspect-square bg-white/[0.02] rounded-2xl mb-6 relative overflow-hidden flex items-center justify-center inner-depth">
      <Box size={48} strokeWidth={0.5} className="text-white/10 group-hover:scale-110 group-hover:text-cyber-blue/30 transition-all duration-700" />
      {verified && <div className="absolute top-4 right-4 text-gold drop-shadow-[0_0_10px_rgba(212,175,55,0.5)]"><ShieldCheck size={16} /></div>}
    </div>
    <div className="space-y-3">
      <div className="flex justify-between items-start">
        <span className="text-[9px] font-mono text-white/20 uppercase tracking-widest">{tech} // {id}</span>
        <span className="text-xs font-bold text-white/80 font-mono">{price}</span>
      </div>
      <h4 className="text-md font-bold tracking-tight uppercase group-hover:text-cyber-blue transition-colors duration-300">{title}</h4>
      <div className="h-[1px] w-full bg-white/5 group-hover:bg-cyber-blue/20 transition-colors" />
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
