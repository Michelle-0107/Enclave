 "use client";
import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { Shell, Heading } from "../../../../../../maintenance/src/app/maintenance/_components";

export default function ReportBlocker() {
 const {id}=useParams<{id:string}>(); const router=useRouter(); const [type,setType]=useState("Waiting for replacement parts"); const [details,setDetails]=useState("");
 return <Shell active="tasks">
  <div className="m-breadcrumb" style={{marginBottom:18}}><a href={`/maintenance/tasks/${id}`}>‹ Task details</a></div>
  <Heading title="Report a blocker." subtitle={`#${id} · ${id==="1025"?"Broken kerb ramp":"Streetlight malfunction"}`} />
  <label className="m-field-label" htmlFor="blocker-type">Blocker type</label>
  <select id="blocker-type" className="m-select" value={type} onChange={e=>setType(e.target.value)}><option>Waiting for replacement parts</option><option>Access unavailable</option><option>Safety concern</option><option>Need specialist support</option><option>Other</option></select>
  <label className="m-field-label" htmlFor="blocker-details">Details</label>
  <textarea id="blocker-details" className="m-textarea" placeholder="Explain what is blocking the repair and next steps..." value={details} onChange={e=>setDetails(e.target.value)}/>
  <p className="m-help">Management receives your blocker note. The task remains open until the repair is verified.</p>
  <button className="m-button full" style={{marginTop:18}} onClick={()=>router.push("/maintenance/notifications")}>Send blocker update</button>
 </Shell>;
}
