import React from 'react';
import { motion, HTMLMotionProps } from 'framer-motion';

interface MotionListProps extends HTMLMotionProps<"div"> {
  children: React.ReactNode;
}

export const MotionList = ({ children, className = "", ...props }: MotionListProps) => (
  <motion.div 
    className={`flex flex-col gap-3 ${className}`}
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    transition={{ staggerChildren: 0.1 }}
    {...props}
  >
    {children}
  </motion.div>
);
