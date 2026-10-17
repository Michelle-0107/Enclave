import { Shell, Heading } from "../../../../maintenance/src/app/maintenance/_components";
const items=[
 {icon:"▣",title:"New task assigned",body:"Streetlight repair at Park Entrance.",time:"15 min ago"},
 {icon:"↻",title:"Changes requested",body:"Management added a review note to #1025.",time:"1 hour ago"},
 {icon:"✓",title:"Repair submitted",body:"Your evidence for #1024 is awaiting review.",time:"2 hours ago"},
];
export default function Notifications(){return <Shell active="notifications"><Heading title="Notifications." subtitle="Assignments and management feedback."/><div className="m-card">{items.map((n,i)=><div className="m-notification" key={i}><div className="m-notification-icon">{n.icon}</div><div><strong>{n.title}</strong><p>{n.body}</p><small>{n.time}</small></div></div>)}</div></Shell>}
