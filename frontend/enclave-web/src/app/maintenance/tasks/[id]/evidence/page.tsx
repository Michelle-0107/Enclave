import TaskScreen from "@/components/maintenance/TaskScreen";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <TaskScreen key={id} id={id} view="evidence" />;
}
