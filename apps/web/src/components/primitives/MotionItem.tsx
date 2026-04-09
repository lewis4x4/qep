import React from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';

interface MotionItemProps extends HTMLMotionProps<"div"> {
  children: React.ReactNode;
}

export const MotionItem = ({ children, className = "", ...props }: MotionItemProps) => (
  <motion.div 
    whileHover={{ scale: 1.01, y: -2 }}
    whileTap={{ scale: 0.99 }}
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    className={`group relative flex items-center justify-between p-4 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-qep-orange/30 hover:bg-white/[0.06] transition-all duration-300 cursor-pointer overflow-hidden ${className}`}
    {...props}
  >
    <div className="absolute inset-0 bg-gradient-to-r from-qep-orange/0 via-qep-orange/0 to-qep-orange/0 group-hover:from-qep-orange/5 group-hover:to-transparent transition-all duration-500 pointer-events-none" />
    {children}
  </motion.div>
);
