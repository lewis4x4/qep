import React from 'react';

export const AmbientMatrix = () => (
  <div className="fixed inset-0 z-[-1] overflow-hidden pointer-events-none bg-slate-900">
    <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-qep-orange/20 blur-[120px]" />
    <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-blue-500/10 blur-[100px]" />
    <div className="absolute inset-0 bg-[url('/noise.png')] opacity-[0.03] mix-blend-overlay" />
  </div>
);
