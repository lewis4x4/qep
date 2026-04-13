import { useCustomers } from "../hooks/useCustomers";
import { SalesCustomerCard } from "../components/SalesCustomerCard";
import { CustomerSearchBar } from "../components/CustomerSearchBar";

export function CustomerListPage() {
  const { customers, search, setSearch, isLoading } = useCustomers();

  return (
    <div className="max-w-lg mx-auto">
      {/* Always-visible search */}
      <CustomerSearchBar value={search} onChange={setSearch} />

      {/* Customer list */}
      <div className="px-4 py-3 space-y-2">
        {isLoading ? (
          <div className="flex items-center justify-center h-64">
            <div className="w-8 h-8 border-3 border-qep-orange border-t-transparent rounded-full animate-spin" />
          </div>
        ) : customers.length > 0 ? (
          customers.map((customer) => (
            <SalesCustomerCard
              key={customer.customer_id}
              customer={customer}
            />
          ))
        ) : search ? (
          <div className="text-center py-12">
            <p className="text-slate-500 text-sm">
              No customers match "{search}"
            </p>
          </div>
        ) : (
          <div className="text-center py-12">
            <p className="text-slate-500 text-sm">
              No customers yet. Start by logging a visit.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
