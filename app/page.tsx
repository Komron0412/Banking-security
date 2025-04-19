'use client';

import React from 'react';
import FaceVerification from './components/FaceVerification';

export default function Home() {
  return (
    <main className="min-h-screen p-8">
      <h1 className="text-3xl font-bold text-center mb-8">Bank Security Verification</h1>
      <FaceVerification />
    </main>
  );
} 