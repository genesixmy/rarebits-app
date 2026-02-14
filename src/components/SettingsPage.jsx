import React from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ProfileSettings from '@/components/ProfileSettings';
import CategorySettings from '@/components/CategorySettings';
import InvoiceSettings from '@/components/InvoiceSettings';
import { User, Tag, FileText } from 'lucide-react';
import { ProfileFormProvider } from '@/contexts/ProfileFormContext';

const SettingsPage = ({ user, categories, onUpdateCategories, onUpdateProfile }) => {
  return (
    <div className="space-y-6">
      <h1 className="page-title">Tetapan</h1>
      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="profile" className="gap-2">
            <User className="w-4 h-4" /> Profil
          </TabsTrigger>
          <TabsTrigger value="categories" className="gap-2">
            <Tag className="w-4 h-4" /> Kategori
          </TabsTrigger>
          <TabsTrigger value="invoice" className="gap-2">
            <FileText className="w-4 h-4" /> Invois
          </TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="mt-6">
          <ProfileFormProvider userId={user.id}>
            <ProfileSettings user={user} onUpdateProfile={onUpdateProfile} />
          </ProfileFormProvider>
        </TabsContent>
        <TabsContent value="categories" className="mt-6">
          <CategorySettings
            categories={categories}
            onUpdate={onUpdateCategories}
            userId={user.id}
          />
        </TabsContent>
        <TabsContent value="invoice" className="mt-6">
          <InvoiceSettings userId={user.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SettingsPage;
