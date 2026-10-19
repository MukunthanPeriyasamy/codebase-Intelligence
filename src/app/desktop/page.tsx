'use client';
import dynamic from 'next/dynamic';
const DesktopWorkspace = dynamic(() => import('@/components/desktop/Workspace'), { ssr: false });
export default function DesktopPage() { return <DesktopWorkspace />; }
