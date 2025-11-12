import React from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ProfileSettings from '@/components/ProfileSettings';
import CategorySettings from '@/components/CategorySettings';
import { User, Tag } from 'lucide-react';

const SettingsPage = ({ user, categories, onUpdateCategories, onUpdateProfile }) => {
  return (
    <div className="space-y-6">
      <h1 className="page-title">Tetapan</h1>
      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="profile" className="gap-2">
            <User className="w-4 h-4" /> Profil
          </TabsTrigger>
          <TabsTrigger value="categories" className="gap-2">
            <Tag className="w-4 h-4" /> Kategori
          </TabsTrigger>
        </TabsList>
        <TabsContent value="profile" className="mt-6" forceMount>
          <ProfileSettings user={user} onUpdateProfile={onUpdateProfile} />
        </TabsContent>
        <TabsContent value="categories" className="mt-6" forceMount>
          <CategorySettings
            categories={categories}
            onUpdate={onUpdateCategories}
            userId={user.id}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
};

export default SettingsPage;