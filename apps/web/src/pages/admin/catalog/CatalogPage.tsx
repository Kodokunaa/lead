import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { CoursesTab } from './CoursesTab';
import { ProgramsTab } from './ProgramsTab';
import { TermsTab } from './TermsTab';

/** A05 Course Management: the course catalog, CCC's programs and the academic terms. */
export function CatalogPage() {
  return (
    <section aria-labelledby="page-title">
      <h1 id="page-title" className="text-2xl font-bold">
        Course Management
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">
        The courses CCC offers, the programs they belong to, and the school terms.
      </p>
      <Tabs defaultValue="courses" className="mt-6">
        <TabsList>
          <TabsTrigger value="courses">Courses</TabsTrigger>
          <TabsTrigger value="programs">Programs</TabsTrigger>
          <TabsTrigger value="terms">Terms</TabsTrigger>
        </TabsList>
        <TabsContent value="courses" className="animate-fade mt-4">
          <CoursesTab />
        </TabsContent>
        <TabsContent value="programs" className="animate-fade mt-4">
          <ProgramsTab />
        </TabsContent>
        <TabsContent value="terms" className="animate-fade mt-4">
          <TermsTab />
        </TabsContent>
      </Tabs>
    </section>
  );
}
