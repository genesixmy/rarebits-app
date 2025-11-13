import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Loader2, Plus, Search, Edit, Trash2, MoreVertical, ChevronLeft, ChevronRight } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/lib/customSupabaseClient';
import ClientFormModal from './ClientFormModal';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const fetchClientsWithStats = async (userId) => {
  const { data: clients, error: clientsError } = await supabase
    .from('clients')
    .select('*, client_phones(*), client_addresses(*)')
    .eq('user_id', userId)
    .order('name', { ascending: true });
  if (clientsError) throw clientsError;

  const { data: items, error: itemsError } = await supabase
    .from('items')
    .select('client_id, selling_price')
    .eq('user_id', userId)
    .eq('status', 'terjual')
    .not('client_id', 'is', null);
  if (itemsError) throw itemsError;

  const stats = items.reduce((acc, item) => {
    if (!acc[item.client_id]) {
      acc[item.client_id] = { purchases: 0, totalSpend: 0 };
    }
    acc[item.client_id].purchases += 1;
    acc[item.client_id].totalSpend += parseFloat(item.selling_price) || 0;
    return acc;
  }, {});

  return clients.map(client => ({
    ...client,
    purchases: stats[client.id]?.purchases || 0,
    totalSpend: stats[client.id]?.totalSpend || 0,
  }));
};

const ClientsPage = () => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [searchTerm, setSearchTerm] = useState('');
  const [showClientModal, setShowClientModal] = useState(false);
  const [editingClient, setEditingClient] = useState(null);
  const [deletingClientId, setDeletingClientId] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  const { data: user } = useQuery({
    queryKey: ['user'],
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      return user;
    },
    staleTime: Infinity,
  });

  const { data: clients, isLoading } = useQuery({
    queryKey: ['clients', user?.id],
    queryFn: () => fetchClientsWithStats(user.id),
    enabled: !!user,
  });

  const deleteClientMutation = useMutation({
    mutationFn: async (clientId) => {
      const { error } = await supabase.from('clients').delete().eq('id', clientId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['clients', user?.id] });
      toast({ title: "Pelanggan berjaya dipadam." });
    },
    onError: (error) => {
      toast({ title: "Gagal memadam pelanggan", description: error.message, variant: "destructive" });
    },
    onSettled: () => {
      setDeletingClientId(null);
    }
  });

  const filteredClients = useMemo(() => {
    if (!clients) return [];
    return clients.filter(client =>
      client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      (client.email && client.email.toLowerCase().includes(searchTerm.toLowerCase()))
    );
  }, [clients, searchTerm]);

  const totalPages = Math.ceil(filteredClients.length / itemsPerPage);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentClients = filteredClients.slice(indexOfFirstItem, indexOfLastItem);

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) {
      setCurrentPage(newPage);
    }
  };

  const handleItemsPerPageChange = (e) => {
    setItemsPerPage(Number(e.target.value));
    setCurrentPage(1);
  };

  const handleSaveClient = () => {
    queryClient.invalidateQueries({ queryKey: ['clients', user?.id] });
    setShowClientModal(false);
    setEditingClient(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <h1 className="page-title">Pelanggan</h1>
        <div className="flex gap-2">
          <div className="relative flex-grow">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
            <Input placeholder="Cari pelanggan..." value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="pl-10" />
          </div>
          <Button onClick={() => { setEditingClient(null); setShowClientModal(true); }} className="flex items-center gap-2 text-white brand-gradient brand-gradient-hover">
            <Plus className="w-4 h-4" />
            <span className="hidden sm:inline">Tambah Pelanggan</span>
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-sm text-muted-foreground">
                  <th className="p-4 font-medium">Nama</th>
                  <th className="p-4 font-medium hidden md:table-cell">E-mel</th>
                  <th className="p-4 font-medium text-center hidden sm:table-cell"># Pembelian</th>
                  <th className="p-4 font-medium text-right">Jumlah Belanja</th>
                  <th className="p-4 font-medium text-right"></th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan="5" className="text-center py-12">
                      <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
                    </td>
                  </tr>
                ) : currentClients.length > 0 ? (
                  currentClients.map(client => (
                    <tr 
                      key={client.id} 
                      className="border-t relative group overflow-hidden cursor-pointer"
                      onClick={() => navigate(`/clients/${client.id}`)}
                    >
                      <td className="p-4 font-semibold text-foreground flex items-center gap-3">
                        <div className="absolute left-0 top-0 h-full w-1 bg-primary scale-y-0 group-hover:scale-y-100 transition-transform origin-center duration-300" />
                        <div className="transition-transform duration-300 group-hover:translate-x-2">
                          {client.name}
                        </div>
                      </td>
                      <td className="p-4 text-muted-foreground hidden md:table-cell">{client.email || '-'}</td>
                      <td className="p-4 text-muted-foreground text-center hidden sm:table-cell">{client.purchases}</td>
                      <td className="p-4 text-right font-semibold text-foreground">RM{(client.totalSpend || 0).toFixed(2)}</td>
                      <td className="p-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon">
                              <MoreVertical className="w-4 h-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onClick={() => { setEditingClient(client); setShowClientModal(true); }}>
                              <Edit className="mr-2 h-4 w-4" /> Sunting
                            </DropdownMenuItem>
                            <DropdownMenuItem onClick={() => setDeletingClientId(client.id)} className="text-red-500 focus:text-red-500">
                              <Trash2 className="mr-2 h-4 w-4" /> Padam
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="5" className="text-muted-foreground text-center py-8">Tiada pelanggan ditemui.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
        {totalPages > 1 && (
          <CardFooter className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 border-t">
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Item per halaman:</span>
              <Select value={itemsPerPage} onChange={handleItemsPerPageChange} className="h-9">
                <option value="10">10</option>
                <option value="50">50</option>
                <option value="100">100</option>
              </Select>
            </div>
            <div className="flex items-center gap-4">
              <span className="text-sm text-muted-foreground">
                Halaman {currentPage} dari {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => handlePageChange(currentPage - 1)}
                  disabled={currentPage === 1}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  className="h-9 w-9"
                  onClick={() => handlePageChange(currentPage + 1)}
                  disabled={currentPage === totalPages}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardFooter>
        )}
      </Card>

      {showClientModal && (
        <ClientFormModal
          client={editingClient}
          onSave={handleSaveClient}
          onCancel={() => { setShowClientModal(false); setEditingClient(null); }}
        />
      )}

      <AlertDialog open={!!deletingClientId} onOpenChange={() => setDeletingClientId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Adakah anda pasti?</AlertDialogTitle>
            <AlertDialogDescription>
              Tindakan ini tidak boleh diubah. Ini akan memadamkan pelanggan secara kekal. Item yang dibeli oleh pelanggan ini tidak akan dipadam.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Batal</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteClientMutation.mutate(deletingClientId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={deleteClientMutation.isPending}
            >
              {deleteClientMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "Padam"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

export default ClientsPage;