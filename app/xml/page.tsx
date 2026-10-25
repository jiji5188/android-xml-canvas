"use client";

import dynamic from "next/dynamic";

const XmlEditor = dynamic(() => import("@/components/XmlEditor").then((m) => m.XmlEditor), { ssr: false });

export default function XmlPage() {
  return <XmlEditor />;
}
