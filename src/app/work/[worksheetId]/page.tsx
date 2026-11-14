import { WorkSurface } from "@/components/work/WorkSurface";

export default function WorkPage() {
  return (
    <>
      <h1>The page you write on</h1>
      <p>Work through your worksheet by hand, with room for Albert beside you.</p>
      <WorkSurface problemId="demo/p1" />
    </>
  );
}
