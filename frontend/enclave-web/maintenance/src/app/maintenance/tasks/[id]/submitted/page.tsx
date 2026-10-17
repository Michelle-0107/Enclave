import { Shell, Heading, ButtonLink } from "../../../_components";

export default async function Submitted({ params }: { params: Promise<{ id: string }> }) {
 const { id } = await params;
 return <Shell active="tasks">
  <div className="m-breadcrumb" style={{marginBottom:18}}><a href={`/maintenance/tasks/${id}`}>‹ Task details</a></div>
  <Heading title={id === "1025" ? "Rework submitted." : "Repair submitted."} subtitle={`#${id} · Repair update`} />
  <div className="m-banner"><strong>Awaiting verification</strong><p>Management will review your repair evidence.</p><p>If changes are requested, you can view the feedback, update the repair, and resubmit your evidence.</p></div>
  <ButtonLink href="/maintenance" tone="full">Back to my tasks</ButtonLink>
  <div style={{height:10}}/><ButtonLink href={`/maintenance/tasks/${id}/evidence`} tone="secondary full">View submitted evidence</ButtonLink>
 </Shell>;
}
