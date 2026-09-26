import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {title:"Wardrobe",description:"Your private wardrobe catalogue"};
export default function Layout({children}:{children:React.ReactNode}) {return <html lang="en"><body>{children}</body></html>;}
