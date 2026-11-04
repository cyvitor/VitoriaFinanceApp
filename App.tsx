import { Feather, Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as SecureStore from 'expo-secure-store';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';

const API = process.env.EXPO_PUBLIC_API_BASE_URL ?? 'https://vitoriafinance.vh5.xyz/api/v1';
const TOKEN_KEY = 'vitoriafinance.mobile-token';
const C = {
  bg: '#11141c', surface: '#191d27', raised: '#202532', line: '#2b3140',
  text: '#f1f3f9', muted: '#9ba4b7', faint: '#727d91', purple: '#6c5ce7',
  purpleLight: '#a99dfb', green: '#32c995', red: '#ff796d', blue: '#79a6ff',
};
type TabKey = 'home' | 'month' | 'create' | 'chat' | 'more';
type ModuleKey = 'cards' | 'income' | 'fixed' | 'budget' | 'analysis' | 'future' | 'financing' | 'accounts' | 'areas' | 'categories' | 'vehicles' | 'profile';
type TransactionType = 'income' | 'expense' | 'transfer';
type Area = { id: number; name: string; person_type: string; can_write: boolean };
type Account = { id: number; name: string; bank_name?: string; person_id: number | null; account_type: string; initial_balance: string; color: string };
type Card = { id: number; name: string; brand: string; account_id: number | null; credit_limit: string; closing_day: number; due_day: number; color: string };
type Category = { id: number; name: string; parent_name: string | null; kind: TransactionType; color: string };
type User = { id: number; username: string; full_name: string; workspace_id: number; default_person_id: number | null; is_admin: boolean };
type Transaction = {
  id: number; transaction_type: TransactionType; description: string; amount: string;
  transaction_date: string; competence_year: number | null; competence_month: number | null;
  status: string; person_id: number | null; account_id: number | null; destination_account_id: number | null;
  card_id: number | null; category_id: number | null; category_name: string | null;
  account_name: string | null; payment_method: string | null; notes: string | null;
};
type BudgetRow = {
  id: number; person_id: number; person_name: string; category_id: number; category_name: string;
  parent_name: string | null; start_year: number; start_month: number; planned: string; paid: string;
  pending: string; spent: string; remaining: string; percent: number; exceeded: boolean; released: boolean;
  released_amount: string; include_in_projection: boolean;
};
type BudgetPayload = {
  person_id: number; category_id: number; amount: string; start_year: number; start_month: number;
  include_in_projection: boolean;
};
type Bootstrap = { user: User; selected_area_id: number | null; areas: Area[]; accounts: Account[]; cards: Card[]; categories: Category[] };
type DashboardData = { date: string; selected_area_id: number | null; balance: string; month: { year: number; month: number; income: string; expenses: string; net: string }; recent_transactions: Transaction[] };
type MonthData = { year: number; month: number; selected_area_id: number | null; is_closed: boolean; income: string; expenses: string; net: string; opening_balance: string; closing_balance: string; projected_balance: string; budget_projection_remaining: string; budgets: BudgetRow[]; transactions: Transaction[] };
type Option = { label: string; value: string };

class ApiError extends Error { constructor(message: string, readonly status: number) { super(message); } }

async function api<T>(path: string, token?: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
  });
  if (response.status === 204) return undefined as T;
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new ApiError(body.detail || 'Não foi possível concluir a solicitação.', response.status);
  return body as T;
}

const money = (value: string | number | undefined) => new Intl.NumberFormat('pt-BR', {
  style: 'currency', currency: 'BRL',
}).format(Number(value || 0));
const capitalizeFirst = (value: string) => value ? value[0].toLocaleUpperCase('pt-BR') + value.slice(1) : value;
const monthName = (year: number, month: number) => capitalizeFirst(new Date(year, month - 1, 1)
  .toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' }));
const todayIso = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
};
const isoDate = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
const friendlyError = (error: unknown) => error instanceof Error ? error.message : 'Ocorreu um erro inesperado.';

function FinanceApp() {
  const insets = useSafeAreaInsets();
  const [token, setToken] = useState<string | null>(null);
  const [booting, setBooting] = useState(true);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [tab, setTab] = useState<TabKey>('home');
  const [module, setModule] = useState<ModuleKey | null>(null);
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [monthData, setMonthData] = useState<MonthData | null>(null);
  const [areaId, setAreaId] = useState<number | null>(null);
  const [monthCursor, setMonthCursor] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [message, setMessage] = useState('');

  useEffect(() => {
    let alive = true;
    SecureStore.getItemAsync(TOKEN_KEY).then((saved) => { if (alive) setToken(saved); })
      .catch(() => { if (alive) setToken(null); })
      .finally(() => { if (alive) setBooting(false); });
    return () => { alive = false; };
  }, []);

  const refresh = useCallback(async (quiet = false) => {
    if (!token) return;
    if (!quiet) setLoading(true);
    setMessage('');
    try {
      const query = areaId ? `?area_id=${areaId}` : '';
      const nextBootstrap = await api<Bootstrap>(`/bootstrap${query}`, token);
      const nextAreaId = areaId ?? nextBootstrap.selected_area_id;
      setBootstrap(nextBootstrap);
      if (areaId == null && nextAreaId != null) setAreaId(nextAreaId);
      const areaQuery = nextAreaId ? `?area_id=${nextAreaId}` : '';
      const monthQuery = nextAreaId ? `?area_id=${nextAreaId}` : '';
      const [nextDashboard, nextMonth] = await Promise.all([
        api<DashboardData>(`/dashboard${areaQuery}`, token),
        api<MonthData>(`/months/${monthCursor.getFullYear()}/${monthCursor.getMonth() + 1}${monthQuery}`, token),
      ]);
      setDashboard(nextDashboard);
      setMonthData(nextMonth);
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        await SecureStore.deleteItemAsync(TOKEN_KEY);
        setToken(null);
        setBootstrap(null);
      } else setMessage(friendlyError(error));
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [token, areaId, monthCursor]);

  useEffect(() => { if (token) void refresh(); }, [token, areaId, monthCursor, refresh]);

  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      if (tab !== 'home') { setTab('home'); return true; }
      return false;
    });
    return () => listener.remove();
  }, [tab]);

  const signIn = async (username: string, password: string) => {
    setSubmitting(true);
    setMessage('');
    try {
      const result = await api<{ access_token: string }>('/auth/login', undefined, {
        method: 'POST', body: JSON.stringify({ username: username.trim(), password, device_name: 'Vitoria Finance app' }),
      });
      await SecureStore.setItemAsync(TOKEN_KEY, result.access_token);
      setAreaId(null);
      setToken(result.access_token);
      setTab('home'); setModule(null);
    } catch (error) { setMessage(friendlyError(error)); }
    finally { setSubmitting(false); }
  };

  const signOut = async () => {
    const oldToken = token;
    setSubmitting(true);
    try { if (oldToken) await api('/auth/logout', oldToken, { method: 'POST' }); }
    catch { /* local credential removal still completes logout */ }
    await SecureStore.deleteItemAsync(TOKEN_KEY);
    setBootstrap(null); setDashboard(null); setMonthData(null); setAreaId(null); setTab('home'); setModule(null); setToken(null);
    setSubmitting(false);
  };

  const createTransaction = async (payload: Record<string, unknown>) => {
    if (!token) return;
    setSubmitting(true); setMessage('');
    try {
      await api<Transaction>('/transactions', token, { method: 'POST', body: JSON.stringify(payload) });
      setTab('home');
      await refresh(true);
      Alert.alert('Lançamento registrado', 'O lançamento foi salvo nas suas finanças.');
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) { await signOut(); return; }
      setMessage(friendlyError(error));
    } finally { setSubmitting(false); }
  };

  const saveBudget = async (budgetId: number | null, payload: BudgetPayload) => {
    if (!token) throw new Error('Sua sessão expirou. Entre novamente.');
    const body = budgetId ? {
      amount: payload.amount, start_year: payload.start_year, start_month: payload.start_month,
      include_in_projection: payload.include_in_projection,
    } : payload;
    await api(budgetId ? `/budgets/${budgetId}` : '/budgets', token, {
      method: budgetId ? 'PATCH' : 'POST', body: JSON.stringify(body),
    });
    await refresh(true);
  };

  const deleteBudget = async (budgetId: number) => {
    if (!token) throw new Error('Sua sessão expirou. Entre novamente.');
    await api(`/budgets/${budgetId}`, token, { method: 'DELETE' });
    await refresh(true);
  };

  if (booting) return <View style={styles.center}><ActivityIndicator size="large" color={C.purpleLight} /></View>;
  if (!token) return <LoginScreen onLogin={signIn} loading={submitting} message={message} />;

  const monthOptions = { year: monthCursor.getFullYear(), month: monthCursor.getMonth() + 1 };
  const moduleTitles: Record<ModuleKey, string> = { cards: 'Cartões e compras', income: 'Receitas recorrentes', fixed: 'Contas e compras', budget: 'Orçamentos', analysis: 'Análises', future: 'A pagar e receber', financing: 'Financiamentos', accounts: 'Contas bancárias', areas: 'Áreas financeiras', categories: 'Categorias', vehicles: 'Veículos e abastecimento', profile: 'Meu perfil' };
  const title = module ? moduleTitles[module] : tab === 'home' ? 'Dashboard' : tab === 'month' ? 'Visão do mês' : tab === 'create' ? 'Novo lançamento' : tab === 'chat' ? 'Vitoria IA' : 'Mais funcionalidades';

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <StatusBar style="light" backgroundColor={C.bg} />
      <View style={styles.topbar}>
        <View style={styles.topTitleWrap}>
          <Text style={styles.kicker}>VITORIA FINANCE</Text>
          <Text style={styles.topTitle}>{title}</Text>
        </View>
        {module && <Pressable accessibilityLabel="Voltar para funcionalidades" onPress={() => setModule(null)} style={styles.navCircle}><Feather name="arrow-left" size={19} color={C.text} /></Pressable>}
        {bootstrap && !module && tab !== 'create' && tab !== 'more' && tab !== 'chat' && <AreaButton areas={bootstrap.areas} areaId={areaId} onChange={setAreaId} />}
        {tab !== 'create' && <Pressable accessibilityLabel="Novo lançamento" style={styles.topAdd} onPress={() => { setModule(null); setMessage(''); setTab('create'); }}><Feather name="plus" size={20} color="white" /></Pressable>}
      </View>

      {message ? <Pressable style={styles.banner} onPress={() => setMessage('')}><Feather name="alert-circle" size={17} color={C.red} /><Text style={styles.bannerText}>{message}</Text><Feather name="x" size={16} color={C.muted} /></Pressable> : null}

      <View style={styles.body}>
        {!module && tab === 'home' && (
          <DashboardScreen data={dashboard} loading={loading} onRefresh={() => refresh()} onMonth={() => setTab('month')} onCreate={() => setTab('create')} />
        )}
        {!module && tab === 'month' && (
          <MonthScreen data={monthData} cursor={monthOptions} loading={loading}
            cards={bootstrap?.cards ?? []} categories={bootstrap?.categories.filter((item) => item.kind === 'expense') ?? []}
            canManageBudgets={bootstrap?.areas.some((area) => area.id === areaId && area.can_write) ?? false}
            onSaveBudget={saveBudget} onDeleteBudget={deleteBudget}
            onPrevious={() => setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
            onNext={() => setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
            onRefresh={() => refresh()} onCreate={() => setTab('create')} />
        )}
        {!module && tab === 'create' && bootstrap && (
          <TransactionForm data={bootstrap} areaId={areaId} loading={submitting} onSubmit={createTransaction} onCancel={() => { setTab('home'); setMessage(''); }} />
        )}
        {!module && tab === 'chat' && <ChatScreen token={token} />}
        {!module && tab === 'more' && <MoreScreen user={bootstrap?.user} areas={bootstrap?.areas ?? []} onSelect={setModule} onCreate={() => setTab('create')} />}
        {module && bootstrap && <FeatureScreen module={module} token={token} bootstrap={bootstrap} areaId={areaId} monthCursor={monthCursor} monthData={monthData} loading={loading} onRefresh={() => refresh()} onCreate={() => { setModule(null); setTab('create'); }} onSaveBudget={saveBudget} onDeleteBudget={deleteBudget} onLogout={signOut} />}
      </View>

      <View style={[styles.tabBar, { paddingBottom: Math.max(insets.bottom, 8) }]}>
        <TabButton label="Início" icon="home" active={!module && tab === 'home'} onPress={() => { setModule(null); setTab('home'); }} />
        <TabButton label="Mês" icon="calendar" active={!module && tab === 'month'} onPress={() => { setModule(null); setTab('month'); }} />
        <Pressable accessibilityRole="button" accessibilityLabel="Conversar com a Vitoria IA" onPress={() => { setModule(null); setTab('chat'); }} style={styles.aiTab}>
          <View style={[styles.aiCircle, tab === 'chat' && styles.aiCircleActive]}><Feather name="message-circle" size={21} color="white" /><View style={styles.aiSpark}><Feather name="star" size={8} color="white" /></View></View>
          <Text style={[styles.tabLabel, { color: tab === 'chat' ? C.purpleLight : C.muted }]}>Vitoria IA</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Novo lançamento" onPress={() => { setModule(null); setMessage(''); setTab('create'); }} style={styles.launchTab}>
          <View style={[styles.launchCircle, tab === 'create' && styles.launchCircleActive]}><Ionicons name="add" size={23} color="white" /></View>
          <Text style={[styles.tabLabel, tab === 'create' && styles.activeText]}>Lançar</Text>
        </Pressable>
        <TabButton label="Mais" icon="grid" active={!!module || tab === 'more'} onPress={() => { setModule(null); setTab('more'); }} />
      </View>
    </View>
  );
}

function LoginScreen({ onLogin, loading, message }: { onLogin: (username: string, password: string) => void; loading: boolean; message: string }) {
  const insets = useSafeAreaInsets();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  return (
    <KeyboardAvoidingView style={[styles.loginRoot, { paddingTop: insets.top, paddingBottom: insets.bottom }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <StatusBar style="light" backgroundColor={C.bg} />
      <ScrollView contentContainerStyle={styles.loginScroll} keyboardShouldPersistTaps="handled">
        <View style={styles.logoMark}><Text style={styles.logoMarkText}>V</Text></View>
        <Text style={styles.loginBrand}>Vitoria<Text style={styles.loginBrandAccent}>Finance</Text></Text>
        <Text style={styles.loginHeading}>Seu dinheiro, em{ '\n' }uma visão mais clara.</Text>
        <Text style={styles.loginSubheading}>Entre para acompanhar suas finanças.</Text>
        <View style={styles.loginForm}>
          <Field label="Usuário" value={username} onChangeText={setUsername} autoCapitalize="none" autoCorrect={false} returnKeyType="next" />
          <Field label="Senha" value={password} onChangeText={setPassword} secureTextEntry={!showPassword} autoCapitalize="none" returnKeyType="done" onSubmitEditing={() => onLogin(username, password)} right={<Pressable onPress={() => setShowPassword((value) => !value)}><Feather name={showPassword ? 'eye-off' : 'eye'} size={18} color={C.muted} /></Pressable>} />
          {message ? <Text style={styles.loginError}>{message}</Text> : null}
          <PrimaryButton label="Entrar" loading={loading} onPress={() => onLogin(username, password)} />
        </View>
        <Text style={styles.loginFoot}>Acesso protegido à sua área financeira</Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function DashboardScreen({ data, loading, onRefresh, onMonth, onCreate }: {
  data: DashboardData | null; loading: boolean; onRefresh: () => void; onMonth: () => void; onCreate: () => void;
}) {
  const current = data?.month;
  return (
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={C.purpleLight} colors={[C.purple]} />}>
      <View style={styles.greetingRow}>
        <View><Text style={styles.eyebrow}>RESUMO FINANCEIRO</Text><Text style={styles.sectionTitle}>Seu mês em foco</Text></View>
        <Pressable onPress={onMonth} style={styles.smallLink}><Text style={styles.smallLinkText}>Ver mês</Text><Feather name="arrow-up-right" size={15} color={C.purpleLight} /></Pressable>
      </View>
      <View style={styles.balanceCard}>
        <View style={styles.balanceHeader}><Text style={styles.balanceLabel}>Saldo confirmado</Text><View style={styles.walletIcon}><Feather name="briefcase" size={17} color="#fff" /></View></View>
        <Text style={styles.balanceValue}>{data ? money(data.balance) : '—'}</Text>
        <View style={styles.balanceFoot}><Feather name="trending-up" size={14} color="#e1dcff" /><Text style={styles.balanceFootText}>Movimentações já contabilizadas</Text></View>
      </View>
      <View style={styles.statGrid}>
        <StatCard label="Entradas do mês" value={money(current?.income)} icon="arrow-down-left" tone="green" />
        <StatCard label="Saídas do mês" value={money(current?.expenses)} icon="arrow-up-right" tone="red" />
      </View>
      <View style={styles.quickActions}>
        <QuickAction title="Nova despesa" subtitle="Registre uma saída" icon="arrow-up-right" onPress={onCreate} />
        <QuickAction title="Ver mês" subtitle="Acompanhe os lançamentos" icon="calendar" onPress={onMonth} />
      </View>
      <View style={styles.panel}>
        <View style={styles.panelHeading}><View><Text style={styles.panelTitle}>Atividade recente</Text><Text style={styles.panelSubtitle}>Seus últimos lançamentos</Text></View><Pressable onPress={onMonth}><Feather name="arrow-right" size={19} color={C.purpleLight} /></Pressable></View>
        {data?.recent_transactions.length ? data.recent_transactions.slice(0, 6).map((item) => <TransactionRow key={item.id} item={item} />) : <EmptyState title="Nada por aqui ainda" subtitle="Seus lançamentos recentes aparecerão nesta lista." />}
      </View>
      <Text style={styles.refreshHint}>Puxe para baixo para atualizar</Text>
    </ScrollView>
  );
}

function MonthScreen({ data, cursor, loading, cards, categories, canManageBudgets, onSaveBudget, onDeleteBudget, onPrevious, onNext, onRefresh, onCreate }: {
  data: MonthData | null; cursor: { year: number; month: number }; loading: boolean; cards: Card[]; categories: Category[];
  canManageBudgets: boolean; onSaveBudget: (budgetId: number | null, payload: BudgetPayload) => Promise<void>;
  onDeleteBudget: (budgetId: number) => Promise<void>;
  onPrevious: () => void; onNext: () => void; onRefresh: () => void; onCreate: () => void;
}) {
  const [selectedCardId, setSelectedCardId] = useState<number | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<BudgetRow | null>(null);
  const cardGroups = useMemo(() => {
    const groups = new Map<number, { items: Transaction[]; total: number; paid: number; pending: number }>();
    for (const item of data?.transactions ?? []) {
      if (item.transaction_type !== 'expense' || item.card_id == null) continue;
      const group = groups.get(item.card_id) ?? { items: [], total: 0, paid: 0, pending: 0 };
      group.items.push(item);
      const amount = Number(item.amount);
      group.total += amount;
      if (item.status === 'paid') group.paid += amount;
      if (item.status === 'pending') group.pending += amount;
      groups.set(item.card_id, group);
    }
    return [...groups.entries()].map(([id, group]) => ({ id, card: cards.find((item) => item.id === id), ...group }));
  }, [data?.transactions, cards]);
  const cardDetail = cardGroups.find((group) => group.id === selectedCardId);
  const incomeItems = (data?.transactions ?? []).filter((item) => item.transaction_type === 'income')
    .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date) || b.id - a.id);
  const expenseItems = (data?.transactions ?? []).filter((item) => item.transaction_type === 'expense' && item.card_id == null)
    .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date) || b.id - a.id);
  const transferItems = (data?.transactions ?? []).filter((item) => item.transaction_type === 'transfer')
    .sort((a, b) => b.transaction_date.localeCompare(a.transaction_date) || b.id - a.id);
  const incomePaid = incomeItems.filter((item) => item.status === 'paid').reduce((sum, item) => sum + Number(item.amount), 0);
  const incomePending = incomeItems.filter((item) => item.status === 'pending').reduce((sum, item) => sum + Number(item.amount), 0);
  const expensePaid = expenseItems.filter((item) => item.status === 'paid').reduce((sum, item) => sum + Number(item.amount), 0)
    + cardGroups.reduce((sum, group) => sum + group.paid, 0);
  const expensePending = expenseItems.filter((item) => item.status === 'pending').reduce((sum, item) => sum + Number(item.amount), 0)
    + cardGroups.reduce((sum, group) => sum + group.pending, 0);
  const openBudgetEditor = (budget: BudgetRow | null = null) => {
    setEditingBudget(budget);
    setEditorOpen(true);
  };
  const closeBudgetEditor = () => { setEditorOpen(false); setEditingBudget(null); };
  const confirmDeleteBudget = (budget: BudgetRow) => Alert.alert(
    'Excluir orçamento', `O limite de ${budget.category_name} deixará de aparecer nos próximos meses.`,
    [{ text: 'Cancelar', style: 'cancel' }, { text: 'Excluir', style: 'destructive', onPress: () => {
      void onDeleteBudget(budget.id).catch((error) => Alert.alert('Não foi possível excluir', friendlyError(error)));
    } }],
  );

  if (selectedCardId != null) return <CardMonthDetail
    card={cardDetail?.card} cardId={selectedCardId} cursor={cursor} transactions={cardDetail?.items ?? []}
    loading={loading} onBack={() => setSelectedCardId(null)} onPrevious={onPrevious} onNext={onNext}
    onRefresh={onRefresh} onCreate={onCreate}
  />;

  return (
    <>
      <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={C.purpleLight} colors={[C.purple]} />}>
        <View style={styles.monthNav}>
          <Pressable style={styles.navCircle} onPress={onPrevious} accessibilityLabel="Mês anterior"><Feather name="chevron-left" size={21} color={C.text} /></Pressable>
          <View style={styles.monthTitleWrap}><Text style={styles.eyebrow}>COMPETÊNCIA</Text><Text style={styles.monthTitle}>{monthName(cursor.year, cursor.month)}</Text><View style={[styles.periodBadge, data?.is_closed && styles.periodBadgeClosed]}><View style={[styles.periodDot, data?.is_closed && styles.periodDotClosed]} /><Text style={[styles.periodBadgeText, data?.is_closed && styles.periodBadgeTextClosed]}>{data?.is_closed ? 'Mês fechado' : 'Mês aberto'}</Text></View></View>
          <Pressable style={styles.navCircle} onPress={onNext} accessibilityLabel="Próximo mês"><Feather name="chevron-right" size={21} color={C.text} /></Pressable>
        </View>
        <View style={styles.balancePair}>
          <View style={[styles.balanceTile, styles.balanceTileActual]}><Text style={styles.balanceTileLabel}>SALDO ATUAL</Text><Text style={styles.balanceTileValue} numberOfLines={1} adjustsFontSizeToFit>{money(data?.closing_balance)}</Text><Text style={styles.balanceTileHint}>Confirmado</Text></View>
          <View style={[styles.balanceTile, styles.balanceTileProjected]}><View style={styles.balanceTileHeading}><Text style={styles.balanceTileLabel}>SALDO PROJETADO</Text><Feather name="trending-up" size={15} color={C.purpleLight} /></View><Text style={[styles.balanceTileValue, Number(data?.projected_balance ?? 0) < 0 && { color: C.red }]} numberOfLines={1} adjustsFontSizeToFit>{money(data?.projected_balance)}</Text><Text style={styles.balanceTileHint}>Inclui pendências e reserva</Text></View>
        </View>
        <View style={styles.monthListHeading}><View><Text style={styles.panelTitle}>Movimentações do mês</Text><Text style={styles.panelSubtitle}>{data?.transactions.length ?? 0} lançamentos</Text></View><Pressable style={styles.roundAdd} onPress={onCreate} accessibilityLabel="Adicionar lançamento"><Feather name="plus" size={18} color="white" /></Pressable></View>
        <View style={styles.ledgerSection}>
          <View style={styles.ledgerHeader}><View style={styles.ledgerTitleGroup}><View style={[styles.ledgerIcon, { backgroundColor: '#17382e' }]}><Feather name="arrow-down-left" size={18} color={C.green} /></View><View><Text style={styles.eyebrow}>ENTRADAS</Text><Text style={styles.panelTitle}>Receitas do mês</Text></View></View><Text style={[styles.ledgerTotal, { color: C.green }]}>{money(data?.income)}</Text></View>
          <View style={styles.panel}>{incomeItems.length ? incomeItems.map((item) => <TransactionRow key={item.id} item={item} showDate />) : <EmptyState title="Nenhuma entrada" subtitle="As receitas deste mês aparecerão aqui." />}</View>
          <View style={styles.ledgerFooter}><Text style={styles.ledgerFooterText}>Confirmado <Text style={styles.ledgerFooterValue}>{money(incomePaid)}</Text></Text><Text style={styles.ledgerFooterText}>Pendente <Text style={styles.ledgerFooterValue}>{money(incomePending)}</Text></Text></View>
        </View>
        <View style={styles.ledgerSection}>
          <View style={styles.ledgerHeader}><View style={styles.ledgerTitleGroup}><View style={[styles.ledgerIcon, { backgroundColor: '#3a2026' }]}><Feather name="arrow-up-right" size={18} color={C.red} /></View><View><Text style={styles.eyebrow}>SAÍDAS</Text><Text style={styles.panelTitle}>Contas e compras</Text></View></View><Text style={[styles.ledgerTotal, { color: C.red }]}>{money(data?.expenses)}</Text></View>
          <View style={styles.panel}>
            {expenseItems.map((item) => <TransactionRow key={item.id} item={item} showDate />)}
            {cardGroups.map((group) => <Pressable key={group.id} style={styles.ledgerCardRow} onPress={() => setSelectedCardId(group.id)} accessibilityRole="button" accessibilityLabel={`Ver lançamentos do cartão ${group.card?.name ?? group.id}`}>
              <View style={styles.cardMonthIcon}><Feather name="credit-card" size={18} color={C.purpleLight} /></View>
              <View style={styles.cardMonthCopy}><Text style={styles.transactionName} numberOfLines={1}>{group.card?.name ?? 'Cartão'}</Text><Text style={styles.transactionMeta}>{group.items.length} {group.items.length === 1 ? 'compra' : 'compras'} · {group.pending ? `${money(group.pending)} pendente` : 'sem pendências'}</Text></View>
              <View style={styles.cardMonthAmount}><Text style={[styles.transactionAmountText, { color: C.red }]}>{money(group.total)}</Text><Feather name="chevron-right" size={17} color={C.muted} /></View>
            </Pressable>)}
            {!expenseItems.length && !cardGroups.length && <EmptyState title="Nenhuma saída" subtitle="As despesas deste mês aparecerão aqui." />}
          </View>
          <View style={styles.ledgerFooter}><Text style={styles.ledgerFooterText}>Pago <Text style={styles.ledgerFooterValue}>{money(expensePaid)}</Text></Text><Text style={styles.ledgerFooterText}>Pendente <Text style={styles.ledgerFooterValue}>{money(expensePending)}</Text></Text></View>
        </View>
        {!!transferItems.length && <View style={styles.ledgerSection}>
          <View style={styles.ledgerHeader}><View style={styles.ledgerTitleGroup}><View style={styles.ledgerIcon}><Feather name="repeat" size={18} color={C.blue} /></View><View><Text style={styles.eyebrow}>MOVIMENTAÇÃO ENTRE CONTAS</Text><Text style={styles.panelTitle}>Transferências</Text></View></View></View>
          <View style={styles.panel}>{transferItems.map((item) => <TransactionRow key={item.id} item={item} showDate />)}</View>
        </View>}
        <View style={styles.monthSection}>
          <View style={styles.budgetSectionHeader}><View><Text style={styles.panelTitle}>Orçamento</Text><Text style={styles.panelSubtitle}>{data?.budgets.length ?? 0} {data?.budgets.length === 1 ? 'limite para este mês' : 'limites para este mês'}</Text></View>{canManageBudgets && <Pressable style={styles.roundAdd} onPress={() => openBudgetEditor()} accessibilityLabel="Criar orçamento"><Feather name="plus" size={18} color="white" /></Pressable>}</View>
          {data?.budgets.length ? data.budgets.map((budget) => <BudgetCard key={budget.id} budget={budget} canManage={canManageBudgets} onEdit={() => openBudgetEditor(budget)} onDelete={() => confirmDeleteBudget(budget)} />) : <View style={styles.panel}><EmptyState title="Nenhum orçamento definido" subtitle={canManageBudgets ? 'Defina limites por categoria e acompanhe o impacto no saldo projetado.' : 'Ainda não há limites para esta área financeira.'} action={canManageBudgets ? 'Criar orçamento' : undefined} onAction={canManageBudgets ? () => openBudgetEditor() : undefined} /></View>}
        </View>
      </ScrollView>
      <BudgetEditor visible={editorOpen} budget={editingBudget} cursor={cursor} personId={data?.selected_area_id ?? null}
        categories={categories} onClose={closeBudgetEditor} onSave={onSaveBudget} />
    </>
  );
}

function CardMonthDetail({ card, cardId, cursor, transactions, loading, onBack, onPrevious, onNext, onRefresh, onCreate }: {
  card?: Card; cardId: number; cursor: { year: number; month: number }; transactions: Transaction[]; loading: boolean;
  onBack: () => void; onPrevious: () => void; onNext: () => void; onRefresh: () => void; onCreate: () => void;
}) {
  const total = transactions.reduce((sum, item) => sum + Number(item.amount), 0);
  const pending = transactions.filter((item) => item.status === 'pending').reduce((sum, item) => sum + Number(item.amount), 0);
  const sorted = [...transactions].sort((a, b) => b.transaction_date.localeCompare(a.transaction_date) || b.id - a.id);
  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={onRefresh} tintColor={C.purpleLight} colors={[C.purple]} />}>
    <Pressable style={styles.backToMonth} onPress={onBack}><Feather name="arrow-left" size={17} color={C.purpleLight} /><Text style={styles.backToMonthText}>Voltar aos lançamentos</Text></Pressable>
    <View style={styles.monthNav}>
      <Pressable style={styles.navCircle} onPress={onPrevious} accessibilityLabel="Mês anterior"><Feather name="chevron-left" size={21} color={C.text} /></Pressable>
      <View style={styles.monthTitleWrap}><Text style={styles.eyebrow}>{card?.brand || 'CARTÃO'}</Text><Text style={styles.monthTitle}>{card?.name ?? `Cartão ${cardId}`}</Text><Text style={styles.panelSubtitle}>{monthName(cursor.year, cursor.month)}</Text></View>
      <Pressable style={styles.navCircle} onPress={onNext} accessibilityLabel="Próximo mês"><Feather name="chevron-right" size={21} color={C.text} /></Pressable>
    </View>
    <View style={styles.cardDetailSummary}><View><Text style={styles.summaryLabel}>Compras neste mês</Text><Text style={styles.cardDetailTotal}>{money(total)}</Text></View><View style={styles.summaryDivider} /><View><Text style={styles.summaryLabel}>A pagar</Text><Text style={[styles.cardDetailPending, { color: pending ? C.red : C.green }]}>{money(pending)}</Text></View></View>
    <View style={styles.monthListHeading}><View><Text style={styles.panelTitle}>Lançamentos do cartão</Text><Text style={styles.panelSubtitle}>{transactions.length} neste mês</Text></View><Pressable style={styles.roundAdd} onPress={onCreate} accessibilityLabel="Adicionar lançamento"><Feather name="plus" size={18} color="white" /></Pressable></View>
    <View style={styles.panel}>{sorted.length ? sorted.map((item) => <TransactionRow key={item.id} item={item} showDate />) : <EmptyState title="Nenhuma compra neste mês" subtitle="As compras deste cartão aparecerão aqui." />}</View>
  </ScrollView>;
}

function BudgetCard({ budget, canManage, onEdit, onDelete }: {
  budget: BudgetRow; canManage: boolean; onEdit: () => void; onDelete: () => void;
}) {
  return <View style={[styles.budgetCard, budget.exceeded && styles.budgetCardExceeded, budget.released && styles.budgetCardReleased]}>
    <View style={styles.budgetCardHeading}><View style={styles.budgetCardTitle}><Text style={styles.transactionName}>{budget.parent_name ? `${budget.parent_name} · ${budget.category_name}` : budget.category_name}</Text><Text style={styles.transactionMeta}>{budget.person_name}{budget.released ? ' · reserva liberada' : ''}</Text></View><Text style={[styles.budgetRemaining, budget.exceeded && { color: C.red }]}>{budget.released ? `${money(budget.released_amount)} liberados` : money(budget.remaining)}</Text></View>
    <View style={styles.budgetProgressTrack}><View style={[styles.budgetProgressFill, { width: `${Math.max(0, Math.min(100, budget.percent))}%` }, budget.exceeded && styles.budgetProgressExceeded]} /></View>
    <View style={styles.budgetStats}><Text style={styles.budgetStat}>Limite <Text style={styles.budgetStatValue}>{money(budget.planned)}</Text></Text><Text style={styles.budgetStat}>Realizado <Text style={styles.budgetStatValue}>{money(budget.paid)}</Text></Text><Text style={styles.budgetStat}>Pendente <Text style={styles.budgetStatValue}>{money(budget.pending)}</Text></Text></View>
    <View style={styles.budgetCardFooter}><Text style={styles.budgetProjectionHint}>{budget.include_in_projection ? 'Considerado na projeção' : 'Fora da projeção'}</Text>{canManage && <View style={styles.budgetActions}><Pressable onPress={onEdit} accessibilityLabel="Editar orçamento"><Feather name="edit-2" size={16} color={C.purpleLight} /></Pressable><Pressable onPress={onDelete} accessibilityLabel="Excluir orçamento"><Feather name="trash-2" size={16} color={C.red} /></Pressable></View>}</View>
  </View>;
}

function BudgetEditor({ visible, budget, cursor, personId, categories, onClose, onSave }: {
  visible: boolean; budget: BudgetRow | null; cursor: { year: number; month: number }; personId: number | null;
  categories: Category[]; onClose: () => void; onSave: (budgetId: number | null, payload: BudgetPayload) => Promise<void>;
}) {
  const [categoryId, setCategoryId] = useState('');
  const [amount, setAmount] = useState('');
  const [includeInProjection, setIncludeInProjection] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!visible) return;
    setCategoryId(budget ? String(budget.category_id) : '');
    setAmount(budget?.planned ?? '');
    setIncludeInProjection(budget?.include_in_projection ?? true);
    setError('');
  }, [visible, budget?.id, cursor.year, cursor.month]);
  const save = async () => {
    const enteredAmount = amount.trim();
    const normalizedAmount = enteredAmount.includes(',')
      ? enteredAmount.replace(/\./g, '').replace(',', '.')
      : enteredAmount;
    if (!personId || (!budget && !categoryId) || !Number.isFinite(Number(normalizedAmount)) || Number(normalizedAmount) <= 0) {
      setError('Informe a categoria e um limite maior que zero.');
      return;
    }
    setSaving(true); setError('');
    try {
      await onSave(budget?.id ?? null, {
        person_id: personId, category_id: Number(categoryId), amount: normalizedAmount,
        start_year: budget?.start_year ?? cursor.year, start_month: budget?.start_month ?? cursor.month,
        include_in_projection: includeInProjection,
      });
      onClose();
    } catch (saveError) { setError(friendlyError(saveError)); }
    finally { setSaving(false); }
  };
  return <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <Pressable style={styles.modalScrim} onPress={onClose}><Pressable style={styles.budgetEditorCard} onPress={() => undefined}>
      <View style={styles.sheetHandle} /><Text style={styles.modalTitle}>{budget ? 'Editar orçamento' : 'Novo orçamento'}</Text><Text style={styles.modalSub}>Defina quanto pode ser gasto na categoria por mês.</Text>
      {budget ? <View style={styles.budgetCategoryLocked}><Text style={styles.fieldLabel}>Categoria</Text><Text style={styles.budgetLockedValue}>{budget.parent_name ? `${budget.parent_name} · ${budget.category_name}` : budget.category_name}</Text></View> : <SelectField label="Categoria de despesa" value={categoryId} options={categories.map((item) => ({ value: String(item.id), label: item.parent_name ? `${item.parent_name} · ${item.name}` : item.name }))} placeholder="Escolha uma categoria" onChange={setCategoryId} />}
      <Field label="Limite mensal (R$)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0,00" />
      <Text style={styles.fieldLabel}>Impacto no saldo projetado</Text><View style={styles.pillRow}><Pill label="Considerar" active={includeInProjection} onPress={() => setIncludeInProjection(true)} /><Pill label="Ignorar" active={!includeInProjection} onPress={() => setIncludeInProjection(false)} /></View>
      {error ? <Text style={styles.loginError}>{error}</Text> : null}
      <View style={styles.formButtons}><SecondaryButton label="Cancelar" onPress={onClose} disabled={saving} /><PrimaryButton label={budget ? 'Salvar alterações' : 'Criar orçamento'} loading={saving} onPress={() => { void save(); }} /></View>
    </Pressable></Pressable>
  </Modal>;
}

function TransactionForm({ data, areaId, loading, onSubmit, onCancel }: {
  data: Bootstrap; areaId: number | null; loading: boolean;
  onSubmit: (payload: Record<string, unknown>) => void; onCancel: () => void;
}) {
  const [kind, setKind] = useState<TransactionType>('expense');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [transactionDate, setTransactionDate] = useState(todayIso());
  const [datePickerOpen, setDatePickerOpen] = useState(false);
  const [personId, setPersonId] = useState(areaId ? String(areaId) : '');
  const [accountId, setAccountId] = useState('');
  const [destinationAccountId, setDestinationAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [cardId, setCardId] = useState('');
  const [paymentSource, setPaymentSource] = useState<'account' | 'card'>('account');
  const [paymentMethod, setPaymentMethod] = useState('Crédito');
  const [installments, setInstallments] = useState('1');
  const [status, setStatus] = useState('paid');
  const [notes, setNotes] = useState('');

  useEffect(() => {
    setPersonId(areaId ? String(areaId) : '');
    setAccountId('');
    setCardId('');
  }, [areaId]);

  const writableAreas = data.areas.filter((area) => area.can_write);
  const filteredAccounts = useMemo(() => data.accounts.filter((account) => account.person_id === Number(personId)), [data.accounts, personId]);
  const filteredCards = useMemo(() => data.cards.filter((card) => filteredAccounts.some((account) => account.id === card.account_id)), [data.cards, filteredAccounts]);
  const filteredCategories = data.categories.filter((category) => category.kind === kind);
  const transferAccounts = data.accounts.filter((account) => account.person_id == null ? data.user.is_admin : writableAreas.some((area) => area.id === account.person_id));

  const makePayload = () => {
    const rawAmount = amount.trim().replace(/\s/g, '');
    const parsedAmount = rawAmount.includes(',') ? rawAmount.replace(/\./g, '').replace(',', '.') : rawAmount;
    const base: Record<string, unknown> = {
      transaction_type: kind, description: description.trim(), amount: parsedAmount,
      transaction_date: transactionDate, status,
      ...(notes.trim() ? { notes: notes.trim() } : {}),
    };
    if (kind === 'transfer') {
      return { ...base, account_id: Number(accountId), destination_account_id: Number(destinationAccountId) };
    }
    return {
      ...base, person_id: Number(personId),
      ...(categoryId ? { category_id: Number(categoryId) } : {}),
      ...(cardId ? { card_id: Number(cardId), payment_method: paymentMethod, ...(paymentMethod === 'Crédito' ? { installments: Number(installments || 1) } : {}) } : accountId ? { account_id: Number(accountId) } : {}),
    };
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={8}>
      <ScrollView contentContainerStyle={[styles.content, styles.formContent]} keyboardShouldPersistTaps="handled">
        <View style={styles.formTop}><Pressable style={styles.backButton} onPress={onCancel}><Feather name="arrow-left" size={19} color={C.text} /></Pressable><View style={{ flex: 1 }}><Text style={styles.panelTitle}>Adicionar lançamento</Text><Text style={styles.panelSubtitle}>Os campos com * são necessários</Text></View></View>
        <View style={styles.typeSwitch}>
          {(['expense', 'income', 'transfer'] as TransactionType[]).map((value) => <Pressable key={value} onPress={() => { setKind(value); setCategoryId(''); setCardId(''); setPaymentSource('account'); }} style={[styles.typeOption, kind === value && styles.typeOptionActive]}><Text style={[styles.typeOptionText, kind === value && styles.typeOptionTextActive]}>{value === 'expense' ? 'Despesa' : value === 'income' ? 'Receita' : 'Transferência'}</Text></Pressable>)}
        </View>
        <View style={styles.amountBox}><Text style={styles.amountCaption}>VALOR DO LANÇAMENTO</Text><View style={styles.amountInputRow}><Text style={styles.currencyPrefix}>R$</Text><TextInput value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0,00" placeholderTextColor={C.faint} style={styles.amountInput} /></View></View>
        <Field label="Descrição *" value={description} onChangeText={setDescription} placeholder={kind === 'expense' ? 'Ex.: mercado, aluguel...' : 'Ex.: salário...'} />
        <Text style={styles.fieldLabel}>Data *</Text>
        <Pressable style={styles.selectField} onPress={() => setDatePickerOpen(true)}><Feather name="calendar" size={16} color={C.purpleLight} /><Text style={styles.selectText}>{new Date(`${transactionDate}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</Text><Feather name="chevron-down" size={17} color={C.muted} /></Pressable>
        {datePickerOpen && Platform.OS === 'ios' && <Modal visible transparent animationType="slide" onRequestClose={() => setDatePickerOpen(false)}><Pressable style={styles.modalScrim} onPress={() => setDatePickerOpen(false)}><Pressable style={styles.datePickerCard} onPress={() => undefined}><View style={styles.sheetHandle} /><Text style={styles.modalTitle}>Data do lançamento</Text><DateTimePicker value={new Date(`${transactionDate}T12:00:00`)} mode="date" display="spinner" onChange={(_, value) => { if (value) setTransactionDate(isoDate(value)); }} themeVariant="dark" /><PrimaryButton label="Confirmar data" onPress={() => setDatePickerOpen(false)} /></Pressable></Pressable></Modal>}
        {datePickerOpen && Platform.OS === 'android' && <DateTimePicker value={new Date(`${transactionDate}T12:00:00`)} mode="date" display="default" onChange={(_, value) => { setDatePickerOpen(false); if (value) setTransactionDate(isoDate(value)); }} />}
        {kind !== 'transfer' && (
          <SelectField label="Área financeira *" value={personId} options={writableAreas.map((area) => ({ label: area.name, value: String(area.id) }))} placeholder="Selecione uma área" onChange={(value) => { setPersonId(value); setAccountId(''); setCardId(''); }} />
        )}
        {kind === 'transfer' ? <>
          <SelectField label="Conta de origem *" value={accountId} options={transferAccounts.map((account) => ({ label: account.name, value: String(account.id) }))} placeholder="Selecione uma conta" onChange={setAccountId} />
          <SelectField label="Conta de destino *" value={destinationAccountId} options={transferAccounts.filter((account) => String(account.id) !== accountId).map((account) => ({ label: account.name, value: String(account.id) }))} placeholder="Selecione uma conta" onChange={setDestinationAccountId} />
        </> : <>
          <SelectField label="Categoria" value={categoryId} options={filteredCategories.map((category) => ({ label: category.parent_name ? `${category.parent_name} · ${category.name}` : category.name, value: String(category.id) }))} placeholder="Sem categoria" onChange={setCategoryId} />
          {kind === 'expense' ? <>
          <View style={styles.paymentSwitch}><Text style={styles.fieldLabel}>Como pagou?</Text><View style={styles.pillRow}><Pill label="Conta" active={paymentSource === 'account'} onPress={() => { setPaymentSource('account'); setCardId(''); setPaymentMethod('Crédito'); }} /><Pill label="Cartão" active={paymentSource === 'card'} onPress={() => { setPaymentSource('card'); setCardId(''); setPaymentMethod('Crédito'); }} /></View></View>
          {paymentSource === 'card' ? <>
            {filteredCards.length > 0 ? <SelectField label="Cartão" value={cardId} options={filteredCards.map((card) => ({ label: `${card.name}${card.brand ? ` · ${card.brand}` : ''}`, value: String(card.id) }))} placeholder="Escolha um cartão" onChange={setCardId} /> : <Text style={styles.inlineHint}>Não há cartões vinculados a esta área financeira.</Text>}
            {!!cardId && <View style={styles.pillRow}><Pill label="Crédito" active={paymentMethod === 'Crédito'} onPress={() => setPaymentMethod('Crédito')} /><Pill label="Débito" active={paymentMethod === 'débito'} onPress={() => setPaymentMethod('débito')} /></View>}
            {!!cardId && paymentMethod === 'Crédito' && <Field label="Parcelas no crédito (1 a 120)" value={installments} onChangeText={setInstallments} keyboardType="number-pad" placeholder="1" />}
          </> : filteredAccounts.length > 0 ? <SelectField label="Conta bancária" value={accountId} options={filteredAccounts.map((account) => ({ label: account.name, value: String(account.id) }))} placeholder="Selecione uma conta" onChange={setAccountId} /> : <Text style={styles.inlineHint}>Cadastre uma conta na área escolhida para informar de onde saiu o valor.</Text>}
          </> : filteredAccounts.length > 0 ? <SelectField label="Conta bancária" value={accountId} options={filteredAccounts.map((account) => ({ label: account.name, value: String(account.id) }))} placeholder="Selecione uma conta" onChange={setAccountId} /> : <Text style={styles.inlineHint}>Cadastre uma conta na área escolhida para associá-la à receita.</Text>}
          {cardId ? <Text style={styles.inlineHint}>{paymentMethod === 'Crédito' ? 'Esta compra ficará pendente até o pagamento da fatura.' : 'Compras no débito são registradas como pagas.'}</Text> : <View style={styles.paymentSwitch}><Text style={styles.fieldLabel}>Situação</Text><View style={styles.pillRow}><Pill label="Pago" active={status === 'paid'} onPress={() => setStatus('paid')} /><Pill label="Pendente" active={status === 'pending'} onPress={() => setStatus('pending')} /></View></View>}
        </>}
        <Field label="Observações" value={notes} onChangeText={setNotes} placeholder="Opcional" multiline />
        <View style={styles.formButtons}><SecondaryButton label="Cancelar" onPress={onCancel} /><PrimaryButton label="Salvar lançamento" loading={loading} onPress={() => {
          if (!description.trim() || !amount.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(transactionDate)) { Alert.alert('Confira os dados', 'Informe descrição, valor e data no formato AAAA-MM-DD.'); return; }
          if (kind === 'transfer' && (!accountId || !destinationAccountId)) { Alert.alert('Selecione as contas', 'Escolha a origem e o destino da transferência.'); return; }
          if (kind !== 'transfer' && !personId) { Alert.alert('Selecione a área', 'Escolha uma área financeira com permissão de escrita.'); return; }
          if (kind === 'expense' && paymentSource === 'card' && !cardId) { Alert.alert('Selecione um cartão', 'Escolha o cartão usado nesta despesa.'); return; }
          if (cardId && paymentMethod === 'Crédito' && (!/^\d+$/.test(installments) || Number(installments) < 1 || Number(installments) > 120)) { Alert.alert('Parcelamento inválido', 'Escolha de 1 a 120 parcelas.'); return; }
          onSubmit(makePayload());
        }} /></View>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

type ChatItem = { id: number; role: string; content: string; created_at: string };

function ChatScreen({ token }: { token: string }) {
  const [items, setItems] = useState<ChatItem[]>([]);
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const lastItem = items.length ? items[items.length - 1] : undefined;
  const confirmationPending = Boolean(lastItem?.role !== 'user' && lastItem?.content && /posso\s+(confirmar|registrar|salvar|guardar)|quer que eu\s+(confirme|registre|salve|guarde)/i.test(lastItem.content));
  const load = useCallback(async () => {
    setLoading(true);
    try { const result = await api<{ items: ChatItem[] }>('/assistant/history', token); setItems(result.items); setError(''); }
    catch (e) { setError(friendlyError(e)); }
    finally { setLoading(false); }
  }, [token]);
  useEffect(() => { void load(); }, [load]);
  const send = async (text = message) => {
    const clean = text.trim();
    if (!clean || sending) return;
    setSending(true); setMessage(''); setError('');
    setItems((current) => [...current, { id: Date.now(), role: 'user', content: clean, created_at: new Date().toISOString() }]);
    try {
      await api<{ reply: string }>('/assistant/messages', token, { method: 'POST', body: JSON.stringify({ message: clean }) });
      await load();
    } catch (e) { setError(friendlyError(e)); }
    finally { setSending(false); }
  };
  return <View style={styles.chatScreen}>
    {!items.length && <View style={styles.chatWelcome}><View style={styles.chatLogo}><Text style={styles.chatLogoText}>V</Text><Feather name="star" size={12} color="white" style={styles.chatStar} /></View><Text style={styles.sectionTitle}>Oi, eu sou a Vitoria.</Text><Text style={styles.chatWelcomeText}>Posso ajudar a consultar suas finanças, organizar lançamentos e acompanhar seus planos.</Text><View style={styles.chatSuggestions}>{['Quanto gastei este mês?', 'Quais contas vencem?', 'Quero criar um orçamento', 'Cadastre um veículo', 'Me ajude a registrar um gasto'].map((item) => <Pressable key={item} style={styles.chatSuggestion} onPress={() => void send(item)}><Text style={styles.chatSuggestionText}>{item}</Text><Feather name="arrow-up-right" size={15} color={C.purpleLight} /></Pressable>)}</View></View>}
    {!!items.length && <ScrollView style={styles.chatMessages} contentContainerStyle={styles.chatMessageContent} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={C.purpleLight} />}>
      {items.map((item) => <View key={item.id} style={[styles.chatBubble, item.role === 'user' ? styles.chatBubbleUser : styles.chatBubbleAssistant]}><Text style={styles.chatBubbleText}>{item.content}</Text></View>)}
      {confirmationPending && <View style={styles.chatActionRow}><Pressable accessibilityRole="button" style={[styles.chatActionButton, styles.chatActionConfirm]} disabled={sending} onPress={() => void send('sim, confirmar')}><Feather name="check" size={15} color={C.green} /><Text style={[styles.chatActionText, { color: C.green }]}>Confirmar</Text></Pressable><Pressable accessibilityRole="button" style={styles.chatActionButton} disabled={sending} onPress={() => void send('não, cancelar')}><Feather name="x" size={15} color={C.red} /><Text style={[styles.chatActionText, { color: C.red }]}>Cancelar</Text></Pressable></View>}
      {sending && <View style={[styles.chatBubble, styles.chatBubbleAssistant]}><ActivityIndicator size="small" color={C.purpleLight} /></View>}
    </ScrollView>}
    {!!error && <Text style={styles.chatError}>{error}</Text>}
    <View style={styles.chatComposer}><TextInput value={message} onChangeText={setMessage} placeholder="Pergunte à Vitoria..." placeholderTextColor={C.faint} multiline style={styles.chatInput} returnKeyType="send" /><Pressable disabled={sending || !message.trim()} onPress={() => void send()} style={[styles.chatSend, (!message.trim() || sending) && styles.disabled]} accessibilityLabel="Enviar mensagem"><Feather name="arrow-up" size={19} color="white" /></Pressable></View>
  </View>;
}

function MoreScreen({ user, areas, onSelect, onCreate }: { user?: User; areas: Area[]; onSelect: (key: ModuleKey) => void; onCreate: () => void }) {
  const entries: { key: ModuleKey; icon: keyof typeof Feather.glyphMap; title: string; detail: string; tint: string }[] = [
    { key: 'cards', icon: 'credit-card', title: 'Cartões e compras', detail: 'Faturas, parcelas, compras e limites', tint: C.purpleLight },
    { key: 'income', icon: 'trending-up', title: 'Receitas recorrentes', detail: 'Configure a conta e confirme recebimentos', tint: C.green },
    { key: 'fixed', icon: 'file-text', title: 'Contas e compras', detail: 'Despesas fixas, vencimentos e pagamentos', tint: C.red },
    { key: 'budget', icon: 'pie-chart', title: 'Orçamentos', detail: 'Limites por categoria e impacto no saldo', tint: C.purpleLight },
    { key: 'analysis', icon: 'bar-chart-2', title: 'Análises financeiras', detail: 'Histórico, categorias e saldo projetado', tint: C.blue },
    { key: 'future', icon: 'clock', title: 'A pagar e receber', detail: 'Previsões que aguardam confirmação', tint: '#efbd67' },
    { key: 'financing', icon: 'dollar-sign', title: 'Financiamentos e dívidas', detail: 'Parcelas, saldo devedor e amortizações', tint: C.green },
    { key: 'accounts', icon: 'briefcase', title: 'Contas bancárias', detail: 'Contas e saldos iniciais', tint: C.blue },
    { key: 'areas', icon: 'users', title: 'Áreas financeiras', detail: 'Pessoal, família e permissões', tint: C.purpleLight },
    { key: 'categories', icon: 'tag', title: 'Categorias', detail: 'Organize receitas e despesas', tint: '#efbd67' },
    { key: 'vehicles', icon: 'truck', title: 'Veículos e abastecimento', detail: 'Quilometragem e consumo', tint: C.red },
    { key: 'profile', icon: 'user', title: 'Meu perfil', detail: 'Sua conta, memória da Vitoria e acesso', tint: C.muted },
  ];
  return <ScrollView contentContainerStyle={styles.content}>
    <View style={styles.moreWelcome}><Text style={styles.eyebrow}>CENTRAL FINANCEIRA</Text><Text style={styles.moreWelcomeTitle}>Tudo no seu ritmo.</Text><Text style={styles.panelSubtitle}>{user?.full_name} · {areas.length} {areas.length === 1 ? 'área financeira' : 'áreas financeiras'}</Text></View>
    <Pressable style={styles.moreLaunch} onPress={onCreate}><View style={styles.moreLaunchIcon}><Feather name="plus" size={20} color="white" /></View><View style={{ flex: 1 }}><Text style={styles.moreLaunchTitle}>Novo lançamento</Text><Text style={styles.moreLaunchSub}>Receita, despesa ou transferência</Text></View><Feather name="chevron-right" size={18} color={C.muted} /></Pressable>
    {entries.map((entry) => <Pressable key={entry.key} style={styles.featureRow} onPress={() => onSelect(entry.key)}><View style={[styles.featureIcon, { backgroundColor: `${entry.tint}1a` }]}><Feather name={entry.icon} size={18} color={entry.tint} /></View><View style={styles.featureCopy}><Text style={styles.featureTitle}>{entry.title}</Text><Text style={styles.featureDetail}>{entry.detail}</Text></View><Feather name="chevron-right" size={17} color={C.faint} /></Pressable>)}
  </ScrollView>;
}

function FeatureScreen({ module, token, bootstrap, areaId, monthCursor, monthData, loading, onRefresh, onCreate, onSaveBudget, onDeleteBudget, onLogout }: { module: ModuleKey; token: string; bootstrap: Bootstrap; areaId: number | null; monthCursor: Date; monthData: MonthData | null; loading: boolean; onRefresh: () => void; onCreate: () => void; onSaveBudget: (budgetId: number | null, payload: BudgetPayload) => Promise<void>; onDeleteBudget: (budgetId: number) => Promise<void>; onLogout: () => void }) {
  if (module === 'income' || module === 'fixed') return <RecurringScreen token={token} bootstrap={bootstrap} areaId={areaId} cursor={monthCursor} kind={module === 'income' ? 'income' : 'expense'} />;
  if (module === 'budget') return <MonthScreen data={monthData} cursor={{ year: monthCursor.getFullYear(), month: monthCursor.getMonth() + 1 }} loading={loading} cards={bootstrap.cards} categories={bootstrap.categories.filter((x) => x.kind === 'expense')} canManageBudgets={bootstrap.areas.some((x) => x.id === areaId && x.can_write)} onSaveBudget={onSaveBudget} onDeleteBudget={onDeleteBudget} onPrevious={() => undefined} onNext={() => undefined} onRefresh={onRefresh} onCreate={onCreate} />;
  if (module === 'cards') return <CardHubScreen token={token} bootstrap={bootstrap} areaId={areaId} cursor={monthCursor} onCreate={onCreate} />;
  if (module === 'analysis') return <AnalysisScreen token={token} areaId={areaId} />;
  if (module === 'future') return <FutureScreen token={token} loading={loading} onRefresh={onRefresh} />;
  if (module === 'accounts') return <AccountsScreen token={token} bootstrap={bootstrap} areaId={areaId} />;
  if (module === 'financing') return <FinancingScreen token={token} bootstrap={bootstrap} areaId={areaId} />;
  if (module === 'areas') return <AreasScreen token={token} bootstrap={bootstrap} />;
  if (module === 'categories') return <CategoriesScreen token={token} bootstrap={bootstrap} />;
  if (module === 'vehicles') return <VehiclesScreen token={token} />;
  if (module === 'profile') return <ProfileScreen user={bootstrap.user} areas={bootstrap.areas} token={token} loading={false} onLogout={onLogout} />;
  return null;
}

type RecurrenceRow = { id: number; transaction_type: TransactionType; description: string; amount: string; person_id: number; person_name: string; account_id: number | null; account_name: string | null; category_id: number | null; category_name: string | null; notes: string | null; due_day: number | null; is_active: boolean; occurrence_status: string | null; remaining_amount: string; is_due_this_month: boolean };
type RecurrencePayload = { transaction_type: TransactionType; description: string; amount: string; person_id: number; account_id: number | null; category_id: number | null; notes: string | null; due_day: number | null };

function RecurringScreen({ token, bootstrap, areaId, cursor, kind }: { token: string; bootstrap: Bootstrap; areaId: number | null; cursor: Date; kind: 'income' | 'expense' }) {
  const [items, setItems] = useState<RecurrenceRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<RecurrenceRow | null>(null);
  const [editor, setEditor] = useState(false);
  const [description, setDescription] = useState(''); const [amount, setAmount] = useState(''); const [personId, setPersonId] = useState(''); const [accountId, setAccountId] = useState(''); const [categoryId, setCategoryId] = useState(''); const [dueDay, setDueDay] = useState(''); const [notes, setNotes] = useState('');
  const [paying, setPaying] = useState<RecurrenceRow | null>(null); const [payAmount, setPayAmount] = useState(''); const [payAccountId, setPayAccountId] = useState(''); const [payCardId, setPayCardId] = useState(''); const [partial, setPartial] = useState(false); const [saving, setSaving] = useState(false);
  const year = cursor.getFullYear(), month = cursor.getMonth() + 1;
  const load = useCallback(async () => { setLoading(true); try { const result = await api<{ items: RecurrenceRow[] }>(`/recurrences?kind=${kind}&year=${year}&month=${month}${areaId ? `&area_id=${areaId}` : ''}`, token); setItems(result.items); setError(''); } catch (e) { setError(friendlyError(e)); } finally { setLoading(false); } }, [token, kind, year, month, areaId]);
  useEffect(() => { void load(); }, [load]);
  const resetEditor = (row: RecurrenceRow | null) => { setEditing(row); setDescription(row?.description ?? ''); setAmount(row?.amount ?? ''); setPersonId(String(row?.person_id ?? areaId ?? '')); setAccountId(String(row?.account_id ?? '')); setCategoryId(String(row?.category_id ?? '')); setDueDay(String(row?.due_day ?? '')); setNotes(row?.notes ?? ''); setEditor(true); };
  const save = async () => { const normalized = amount.trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.'); if (!description.trim() || Number(normalized) <= 0 || !personId) { Alert.alert('Confira os dados', 'Informe descrição, valor e área financeira.'); return; } setSaving(true); try { const payload: RecurrencePayload = { transaction_type: kind, description: description.trim(), amount: normalized, person_id: Number(personId), account_id: accountId ? Number(accountId) : null, category_id: categoryId ? Number(categoryId) : null, notes: notes.trim() || null, due_day: dueDay ? Number(dueDay) : null }; await api(editing ? `/recurrences/${editing.id}` : '/recurrences', token, { method: editing ? 'PATCH' : 'POST', body: JSON.stringify(payload) }); setEditor(false); await load(); } catch (e) { Alert.alert('Não foi possível salvar', friendlyError(e)); } finally { setSaving(false); } };
  const openPayment = (row: RecurrenceRow) => { setPaying(row); setPayAmount(row.remaining_amount || row.amount); setPayAccountId(String(row.account_id ?? '')); setPayCardId(''); setPartial(false); };
  const confirmPayment = async () => { if (!paying) return; const normalized = payAmount.trim().replace(/\s/g, '').replace(/\./g, '').replace(',', '.'); if (Number(normalized) <= 0) { Alert.alert('Valor inválido', 'Informe o valor recebido ou pago.'); return; } if (kind === 'expense' && !payAccountId && !payCardId) { Alert.alert('Selecione como pagou', 'Escolha uma conta bancária ou cartão.'); return; } setSaving(true); try { await api(`/recurrences/${paying.id}/confirm`, token, { method: 'POST', body: JSON.stringify({ year, month, amount: normalized, transaction_date: todayIso(), ...(kind === 'expense' ? { account_id: payCardId ? null : Number(payAccountId), card_id: payCardId ? Number(payCardId) : null, settlement_mode: partial ? 'partial' : 'full' } : {}) }) }); setPaying(null); await load(); } catch (e) { Alert.alert('Não foi possível confirmar', friendlyError(e)); } finally { setSaving(false); } };
  const skip = (row: RecurrenceRow) => Alert.alert('Ignorar neste mês?', `${row.description} não será lançado em ${monthName(year, month)}.`, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Ignorar', onPress: () => { void api(`/recurrences/${row.id}/skip?year=${year}&month=${month}`, token, { method: 'POST' }).then(load).catch((e) => Alert.alert('Falha', friendlyError(e))); } }]);
  const remove = (row: RecurrenceRow) => Alert.alert('Desativar recorrência?', 'Os lançamentos já confirmados serão mantidos.', [{ text: 'Cancelar', style: 'cancel' }, { text: 'Desativar', style: 'destructive', onPress: () => { void api(`/recurrences/${row.id}`, token, { method: 'DELETE' }).then(load).catch((e) => Alert.alert('Falha', friendlyError(e))); } }]);
  const filteredAccounts = bootstrap.accounts.filter((x) => x.person_id === Number(personId)); const filteredCards = bootstrap.cards.filter((x) => filteredAccounts.some((a) => a.id === x.account_id));
  const categoryOptions = bootstrap.categories.filter((x) => x.kind === kind).map((x) => ({ value: String(x.id), label: x.parent_name ? `${x.parent_name} · ${x.name}` : x.name }));
  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={C.purpleLight} />}>
    <View style={styles.moduleIntro}><Text style={styles.eyebrow}>{kind === 'income' ? 'ENTRADAS PROGRAMADAS' : 'DESPESAS FIXAS'}</Text><Text style={styles.panelSubtitle}>{kind === 'income' ? 'Defina a conta de destino uma vez e confirme cada recebimento no mês.' : 'Cadastre despesas e confirme cada pagamento sem perder o histórico.'}</Text></View>
    <Pressable style={styles.moreLaunch} onPress={() => resetEditor(null)}><View style={styles.moreLaunchIcon}><Feather name="plus" size={20} color="white" /></View><View style={{ flex: 1 }}><Text style={styles.moreLaunchTitle}>{kind === 'income' ? 'Configurar receita' : 'Cadastrar conta ou compra fixa'}</Text><Text style={styles.moreLaunchSub}>Valor, categoria e conta associada</Text></View><Feather name="chevron-right" size={18} color={C.muted} /></Pressable>
    {!!error && <Text style={styles.chatError}>{error}</Text>}
    {items.length ? items.map((row) => <View key={row.id} style={styles.recurringCard}><View style={styles.recurringHeading}><View style={[styles.featureIcon, { backgroundColor: kind === 'income' ? '#18352f' : '#3a2026' }]}><Feather name={kind === 'income' ? 'trending-up' : 'file-text'} size={17} color={kind === 'income' ? C.green : C.red} /></View><View style={styles.featureCopy}><Text style={styles.featureTitle}>{row.description}</Text><Text style={styles.featureDetail}>{row.person_name} · {row.category_name ?? 'Sem categoria'}{row.due_day ? ` · vence dia ${row.due_day}` : ''}</Text><Text style={styles.featureDetail}>{kind === 'income' ? `Destino: ${row.account_name ?? 'definir ao configurar'}` : `Conta padrão: ${row.account_name ?? 'escolher ao pagar'}`}</Text></View><Text style={[styles.ledgerTotal, { color: kind === 'income' ? C.green : C.red }]}>{money(row.occurrence_status === 'partial' ? row.remaining_amount : row.amount)}</Text></View>
      <View style={styles.recurringActions}>{row.occurrence_status === 'confirmed' ? <Text style={styles.occurrenceDone}>{kind === 'income' ? 'Recebida' : 'Paga'} neste mês</Text> : row.occurrence_status === 'skipped' ? <Text style={styles.featureDetail}>Ignorada neste mês</Text> : <><Pressable style={styles.smallPrimary} onPress={() => openPayment(row)}><Text style={styles.smallPrimaryText}>{kind === 'income' ? 'Confirmar recebimento' : row.occurrence_status === 'partial' ? 'Pagar restante' : 'Registrar pagamento'}</Text></Pressable><Pressable style={styles.smallGhost} onPress={() => skip(row)}><Text style={styles.smallGhostText}>Ignorar</Text></Pressable></>}
        <Pressable style={styles.iconAction} onPress={() => resetEditor(row)} accessibilityLabel="Editar recorrência"><Feather name="edit-2" size={15} color={C.purpleLight} /></Pressable><Pressable style={styles.iconAction} onPress={() => remove(row)} accessibilityLabel="Desativar recorrência"><Feather name="trash-2" size={15} color={C.red} /></Pressable></View>
    </View>) : <View style={styles.panel}><EmptyState title={kind === 'income' ? 'Nenhuma receita recorrente' : 'Nenhuma conta fixa'} subtitle={kind === 'income' ? 'Configure salários, aluguéis ou outras entradas mensais.' : 'Cadastre moradia, serviços e parcelas que se repetem.'} action={kind === 'income' ? 'Configurar receita' : 'Cadastrar conta fixa'} onAction={() => resetEditor(null)} /></View>}
    <Modal visible={editor} transparent animationType="slide" onRequestClose={() => setEditor(false)}><Pressable style={styles.modalScrim} onPress={() => setEditor(false)}><Pressable style={styles.featureSheet} onPress={() => undefined}><View style={styles.sheetHandle} /><Text style={styles.modalTitle}>{editing ? 'Editar programação' : kind === 'income' ? 'Configurar receita' : 'Nova conta fixa'}</Text><Field label="Descrição" value={description} onChangeText={setDescription} placeholder={kind === 'income' ? 'Ex.: Salário' : 'Ex.: Internet'} /><Field label="Valor mensal (R$)" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" placeholder="0,00" /><SelectField label="Área financeira" value={personId} options={bootstrap.areas.filter((a) => a.can_write).map((a) => ({ value: String(a.id), label: a.name }))} placeholder="Escolha uma área" onChange={(v) => { setPersonId(v); setAccountId(''); }} /><SelectField label={kind === 'income' ? 'Conta onde receber' : 'Conta padrão para pagar'} value={accountId} options={filteredAccounts.map((a) => ({ value: String(a.id), label: a.name }))} placeholder="Definir na confirmação" onChange={setAccountId} /><SelectField label="Categoria" value={categoryId} options={categoryOptions} placeholder="Sem categoria" onChange={setCategoryId} />{kind === 'expense' && <Field label="Dia do vencimento (opcional)" value={dueDay} onChangeText={setDueDay} keyboardType="number-pad" placeholder="1 a 31" />}<Field label="Observações" value={notes} onChangeText={setNotes} multiline placeholder="Opcional" /><View style={styles.formButtons}><SecondaryButton label="Cancelar" onPress={() => setEditor(false)} /><PrimaryButton label="Salvar" loading={saving} onPress={() => void save()} /></View></Pressable></Pressable></Modal>
    <Modal visible={!!paying} transparent animationType="slide" onRequestClose={() => setPaying(null)}><Pressable style={styles.modalScrim} onPress={() => setPaying(null)}><Pressable style={styles.featureSheet} onPress={() => undefined}><View style={styles.sheetHandle} /><Text style={styles.modalTitle}>{kind === 'income' ? 'Confirmar recebimento' : 'Registrar pagamento'}</Text><Text style={styles.modalSub}>{paying?.description} · competência {String(month).padStart(2, '0')}/{year}</Text><Field label="Valor (R$)" value={payAmount} onChangeText={setPayAmount} keyboardType="decimal-pad" />{kind === 'expense' && <><SelectField label="Conta bancária" value={payAccountId} options={bootstrap.accounts.filter((a) => a.person_id === paying?.person_id).map((a) => ({ value: String(a.id), label: a.name }))} placeholder="Escolher conta" onChange={(v) => { setPayAccountId(v); setPayCardId(''); }} /><SelectField label="Ou pagar no cartão" value={payCardId} options={bootstrap.cards.filter((c) => bootstrap.accounts.some((a) => a.id === c.account_id && a.person_id === paying?.person_id)).map((c) => ({ value: String(c.id), label: c.name }))} placeholder="Não usar cartão" onChange={(v) => { setPayCardId(v); setPayAccountId(''); }} /><View style={styles.pillRow}><Pill label="Pagamento total" active={!partial} onPress={() => setPartial(false)} /><Pill label="Parcial" active={partial} onPress={() => setPartial(true)} /></View></>}<View style={styles.formButtons}><SecondaryButton label="Cancelar" onPress={() => setPaying(null)} /><PrimaryButton label="Confirmar" loading={saving} onPress={() => void confirmPayment()} /></View></Pressable></Pressable></Modal>
  </ScrollView>;
}

type Statement = { card: Card & { account_name: string | null }; year: number; month: number; is_closed: boolean; credit_total: string; debit_total: string; transactions: Transaction[] };

function CardHubScreen({ token, bootstrap, areaId, cursor, onCreate }: { token: string; bootstrap: Bootstrap; areaId: number | null; cursor: Date; onCreate: () => void }) {
  const [cardId, setCardId] = useState<number | null>(null); const [statement, setStatement] = useState<Statement | null>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState(''); const [adding, setAdding] = useState(false); const [name, setName] = useState(''); const [brand, setBrand] = useState(''); const [accountId, setAccountId] = useState(''); const [limit, setLimit] = useState(''); const [closing, setClosing] = useState(''); const [due, setDue] = useState('');
  const [editing, setEditing] = useState<Transaction | null>(null); const [editDescription, setEditDescription] = useState(''); const [editAmount, setEditAmount] = useState(''); const [editDate, setEditDate] = useState(''); const [editCategory, setEditCategory] = useState(''); const [editInvoice, setEditInvoice] = useState('');
  const year = cursor.getFullYear(), month = cursor.getMonth() + 1;
  const accounts = bootstrap.accounts.filter((a) => a.person_id === areaId);
  const cards = bootstrap.cards.filter((c) => accounts.some((a) => a.id === c.account_id));
  const loadStatement = useCallback(async () => { if (!cardId) return; setLoading(true); try { setStatement(await api<Statement>(`/cards/${cardId}/statement?year=${year}&month=${month}`, token)); setError(''); } catch (e) { setError(friendlyError(e)); } finally { setLoading(false); } }, [token, cardId, year, month]);
  useEffect(() => { void loadStatement(); }, [loadStatement]);
  const billingAction = async (action: 'confirm' | 'reopen') => { if (!cardId) return; try { await api(`/cards/${cardId}/billing/${action}?year=${year}&month=${month}`, token, { method: 'POST' }); await loadStatement(); } catch (e) { Alert.alert('Não foi possível atualizar a fatura', friendlyError(e)); } };
  const createCard = async () => { const parsed = limit.replace(/\./g, '').replace(',', '.'); if (!name.trim() || !accountId || !Number.isFinite(Number(parsed)) || !closing || !due) { Alert.alert('Confira os dados', 'Informe nome, conta, limite e dias de fechamento e vencimento.'); return; } try { await api('/cards', token, { method: 'POST', body: JSON.stringify({ name: name.trim(), brand, account_id: Number(accountId), credit_limit: parsed, closing_day: Number(closing), due_day: Number(due), color: '#6c5ce7' }) }); setAdding(false); Alert.alert('Cartão cadastrado', 'Atualize a tela para carregar o novo cartão.'); } catch (e) { Alert.alert('Não foi possível cadastrar', friendlyError(e)); } };
  const openEdit = (item: Transaction) => { setEditing(item); setEditDescription(item.description); setEditAmount(item.amount); setEditDate(item.transaction_date); setEditCategory(String(item.category_id ?? '')); setEditInvoice(''); };
  const saveEdit = async () => { if (!cardId || !editing) return; const parsed = editAmount.replace(/\./g, '').replace(',', '.'); if (!editDescription.trim() || Number(parsed) <= 0 || !editCategory || !/^\d{4}-\d{2}-\d{2}$/.test(editDate)) { Alert.alert('Confira os dados', 'Informe descrição, valor, categoria e data válida.'); return; } let invoice_year: number | undefined, invoice_month: number | undefined; if (editInvoice.trim()) { const match = /^(\d{4})-(\d{2})$/.exec(editInvoice.trim()); if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) { Alert.alert('Fatura inválida', 'Use o formato AAAA-MM.'); return; } invoice_year = Number(match[1]); invoice_month = Number(match[2]); } try { await api(`/cards/${cardId}/transactions/${editing.id}`, token, { method: 'PATCH', body: JSON.stringify({ description: editDescription.trim(), amount: parsed, category_id: Number(editCategory), transaction_date: editDate, ...(invoice_year ? { invoice_year, invoice_month } : {}) }) }); setEditing(null); await loadStatement(); } catch (e) { Alert.alert('Não foi possível atualizar a compra', friendlyError(e)); } };
  const deletePurchase = (item: Transaction) => { if (!cardId) return; Alert.alert('Excluir compra?', `${item.description} será removida desta fatura.`, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Excluir', style: 'destructive', onPress: () => { void api(`/cards/${cardId}/transactions/${item.id}`, token, { method: 'DELETE' }).then(loadStatement).catch((e) => Alert.alert('Não foi possível excluir', friendlyError(e))); } }]); };
  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void loadStatement()} tintColor={C.purpleLight} />}>
    <View style={styles.moduleIntro}><Text style={styles.eyebrow}>CARTÕES E COMPRAS</Text><Text style={styles.panelSubtitle}>Abra um cartão para ver a fatura, compras parceladas e o que ainda está pendente.</Text></View>
    <View style={styles.moduleActionRow}><Pressable style={styles.moreLaunch} onPress={() => setAdding(true)}><View style={styles.moreLaunchIcon}><Feather name="plus" size={19} color="white" /></View><View style={{ flex: 1 }}><Text style={styles.moreLaunchTitle}>Adicionar cartão</Text><Text style={styles.moreLaunchSub}>Configure limite e vencimento</Text></View><Feather name="chevron-right" size={17} color={C.muted} /></Pressable><Pressable style={styles.purchaseButton} onPress={onCreate}><Feather name="shopping-bag" size={17} color="white" /><Text style={styles.purchaseButtonText}>Nova compra</Text></Pressable></View>
    {cards.length ? cards.map((card) => <Pressable key={card.id} onPress={() => setCardId(card.id)} style={[styles.creditCard, { borderColor: `${card.color}77` }]}><View style={styles.creditHeader}><View><Text style={styles.creditBrand}>{card.brand || 'CARTÃO'}</Text><Text style={styles.creditName}>{card.name}</Text></View><View style={[styles.creditIcon, { backgroundColor: card.color }]}><Feather name="credit-card" size={18} color="white" /></View></View><Text style={styles.creditLimit}>{money(card.credit_limit)}</Text><Text style={styles.creditLimitCaption}>limite total</Text><View style={styles.creditFooter}><Text style={styles.creditFooterText}>{accounts.find((a) => a.id === card.account_id)?.name ?? 'Conta não vinculada'}</Text><Text style={styles.creditFooterText}>Fecha {card.closing_day} · vence {card.due_day}</Text></View><View style={styles.cardOpenHint}><Text style={styles.cardOpenText}>Ver compras desta fatura</Text><Feather name="chevron-right" size={16} color={C.purpleLight} /></View></Pressable>) : <View style={styles.panel}><EmptyState title="Nenhum cartão nesta área" subtitle="Cadastre um cartão para acompanhar compras, parcelas e faturas." action="Adicionar cartão" onAction={() => setAdding(true)} /></View>}
    {cardId && <View style={styles.panel}><View style={styles.statementHeader}><View><Text style={styles.eyebrow}>FATURA · {monthName(year, month)}</Text><Text style={styles.panelTitle}>{statement?.card.name ?? 'Compras do cartão'}</Text></View><Pressable style={styles.navCircle} onPress={() => setCardId(null)}><Feather name="x" size={17} color={C.text} /></Pressable></View>{loading ? <ActivityIndicator color={C.purpleLight} /> : statement && <><View style={styles.statementTotals}><View><Text style={styles.summaryLabel}>Crédito</Text><Text style={[styles.summaryValue, { color: C.red }]}>{money(statement.credit_total)}</Text></View><View><Text style={styles.summaryLabel}>Débito</Text><Text style={[styles.summaryValue, { color: C.green }]}>{money(statement.debit_total)}</Text></View></View>{statement.transactions.length ? statement.transactions.map((item) => <View key={item.id} style={styles.cardPurchaseItem}><TransactionRow item={item} showDate /><View style={styles.cardPurchaseActions}><Pressable onPress={() => openEdit(item)}><Text style={styles.cardActionText}>Editar compra</Text></Pressable><Pressable onPress={() => deletePurchase(item)}><Text style={[styles.cardActionText, { color: C.red }]}>Excluir</Text></Pressable></View></View>) : <EmptyState title="Fatura sem compras" subtitle="As compras deste cartão aparecerão aqui." />}<View style={styles.invoiceFooter}><Text style={styles.featureDetail}>{statement.is_closed ? 'Fatura fechada' : 'Fatura em aberto'}</Text><Pressable onPress={() => void billingAction(statement.is_closed ? 'reopen' : 'confirm')} style={styles.smallPrimary}><Text style={styles.smallPrimaryText}>{statement.is_closed ? 'Reabrir fatura' : 'Confirmar pagamento'}</Text></Pressable></View></>}</View>}
    {!!error && <Text style={styles.chatError}>{error}</Text>}
    <Modal visible={adding} transparent animationType="slide" onRequestClose={() => setAdding(false)}><Pressable style={styles.modalScrim} onPress={() => setAdding(false)}><Pressable style={styles.featureSheet} onPress={() => undefined}><View style={styles.sheetHandle} /><Text style={styles.modalTitle}>Novo cartão</Text><Field label="Nome" value={name} onChangeText={setName} placeholder="Ex.: Cartão principal" /><Field label="Bandeira" value={brand} onChangeText={setBrand} placeholder="Visa, Mastercard..." /><SelectField label="Conta financeira" value={accountId} options={accounts.map((a) => ({ value: String(a.id), label: a.name }))} placeholder="Escolha a conta vinculada" onChange={setAccountId} /><Field label="Limite (R$)" value={limit} onChangeText={setLimit} keyboardType="decimal-pad" /><View style={styles.twoFields}><View style={{ flex: 1 }}><Field label="Fecha dia" value={closing} onChangeText={setClosing} keyboardType="number-pad" /></View><View style={{ flex: 1 }}><Field label="Vence dia" value={due} onChangeText={setDue} keyboardType="number-pad" /></View></View><View style={styles.formButtons}><SecondaryButton label="Cancelar" onPress={() => setAdding(false)} /><PrimaryButton label="Cadastrar" onPress={() => void createCard()} /></View></Pressable></Pressable></Modal>
    <Modal visible={!!editing} transparent animationType="slide" onRequestClose={() => setEditing(null)}><Pressable style={styles.modalScrim} onPress={() => setEditing(null)}><Pressable style={styles.featureSheet} onPress={() => undefined}><View style={styles.sheetHandle} /><Text style={styles.modalTitle}>Editar compra</Text><Field label="Descrição" value={editDescription} onChangeText={setEditDescription} /><Field label="Valor da parcela" value={editAmount} onChangeText={setEditAmount} keyboardType="decimal-pad" /><Field label="Data da compra (AAAA-MM-DD)" value={editDate} onChangeText={setEditDate} /><SelectField label="Categoria" value={editCategory} options={bootstrap.categories.filter((x) => x.kind === 'expense').map((x) => ({ value: String(x.id), label: x.parent_name ? `${x.parent_name} · ${x.name}` : x.name }))} placeholder="Escolha uma categoria" onChange={setEditCategory} /><Field label="Mover para outra fatura (AAAA-MM, opcional)" value={editInvoice} onChangeText={setEditInvoice} placeholder="2026-12" /><View style={styles.formButtons}><SecondaryButton label="Cancelar" onPress={() => setEditing(null)} /><PrimaryButton label="Salvar compra" onPress={() => void saveEdit()} /></View></Pressable></Pressable></Modal>
  </ScrollView>;
}

function AnalysisScreen({ token, areaId }: { token: string; areaId: number | null }) {
  const [history, setHistory] = useState(12); const [horizon, setHorizon] = useState(12); const [data, setData] = useState<any>(null); const [loading, setLoading] = useState(false); const [error, setError] = useState('');
  const load = useCallback(async () => { setLoading(true); try { setData(await api(`/analysis/summary?history=${history}&horizon=${horizon}${areaId ? `&area_id=${areaId}` : ''}`, token)); setError(''); } catch (e) { setError(friendlyError(e)); } finally { setLoading(false); } }, [token, history, horizon, areaId]);
  useEffect(() => { void load(); }, [load]);
  const maxValue = Math.max(1, ...(data?.monthly ?? []).flatMap((x: any) => [Number(x.income), Number(x.expense)]));
  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={C.purpleLight} />}><View style={styles.moduleIntro}><Text style={styles.eyebrow}>RETRATO FINANCEIRO</Text><Text style={styles.panelSubtitle}>Compare receitas, despesas e a tendência do saldo com base no histórico confirmado.</Text></View><View style={styles.pillRow}><Pill label="6 meses" active={history === 6} onPress={() => setHistory(6)} /><Pill label="12 meses" active={history === 12} onPress={() => setHistory(12)} /><Pill label="24 meses" active={history === 24} onPress={() => setHistory(24)} /></View><View style={styles.panel}><ProfileRow label="Receitas no período" value={money(data?.income_total)} /><ProfileRow label="Despesas no período" value={money(data?.expense_total)} /><ProfileRow label="Gastos no crédito" value={money(data?.credit_expense_total)} /><ProfileRow label="Economia média" value={`${Number(data?.savings_rate ?? 0).toFixed(1).replace('.', ',')}%`} /></View><View style={styles.panel}><Text style={styles.panelTitle}>Receitas x despesas</Text><Text style={styles.panelSubtitle}>Valores confirmados por competência</Text>{data?.monthly?.map((row: any) => <View key={`${row.year}-${row.month}`} style={styles.chartMonth}><Text style={styles.chartMonthLabel}>{monthName(row.year, row.month).slice(0, 3)}</Text><View style={styles.chartTracks}><View style={[styles.chartTrack, { width: `${Math.max(2, Number(row.income) / maxValue * 100)}%`, backgroundColor: C.green }]} /><View style={[styles.chartTrack, { width: `${Math.max(2, Number(row.expense) / maxValue * 100)}%`, backgroundColor: C.red }]} /></View><Text style={styles.chartMonthValue}>{money(row.income - row.expense)}</Text></View>)}</View><View style={styles.panel}><View style={styles.statementHeader}><Text style={styles.panelTitle}>Saldo projetado</Text><View style={styles.pillRow}>{[3, 6, 12, 24, 60].map((n) => <Pill key={n} label={`${n}m`} active={horizon === n} onPress={() => setHorizon(n)} />)}</View></View>{data?.projection?.map((row: any) => <ProfileRow key={`${row.year}-${row.month}`} label={monthName(row.year, row.month)} value={money(row.balance)} />)}<Text style={styles.refreshHint}>Projeção estimada pelas médias dos meses completos.</Text></View>{data?.top_categories?.length ? <View style={styles.panel}><Text style={styles.panelTitle}>Categorias com mais despesas</Text>{data.top_categories.slice(0, 6).map((row: any, index: number) => <ProfileRow key={row.name} label={`${index + 1}. ${row.name}`} value={money(row.total)} />)}</View> : null}{!!error && <Text style={styles.chatError}>{error}</Text>}</ScrollView>;
}

function FutureScreen({ token, loading, onRefresh }: { token: string; loading: boolean; onRefresh: () => void }) {
  const [items, setItems] = useState<Transaction[]>([]); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const load = useCallback(async () => { setBusy(true); try { const result = await api<{ items: Transaction[] }>('/future', token); setItems(result.items); setError(''); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); } }, [token]);
  useEffect(() => { void load(); }, [load]);
  const confirm = (item: Transaction) => Alert.alert('Confirmar lançamento?', `${item.description} · ${money(item.amount)} será considerado pago.`, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Confirmar', onPress: () => { void api(`/transactions/${item.id}/confirm`, token, { method: 'POST' }).then(load).catch((e) => Alert.alert('Não foi possível confirmar', friendlyError(e))); } }]);
  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={busy || loading} onRefresh={() => { void load(); onRefresh(); }} tintColor={C.purpleLight} />}><View style={styles.moduleIntro}><Text style={styles.eyebrow}>PREVISÕES</Text><Text style={styles.panelSubtitle}>Confirme receitas e pagamentos quando acontecerem para atualizar o saldo real.</Text></View>{items.length ? <View style={styles.panel}>{items.map((item) => <View key={item.id} style={styles.futureRow}><TransactionRow item={item} showDate /><Pressable style={styles.smallPrimary} onPress={() => confirm(item)}><Text style={styles.smallPrimaryText}>Confirmar</Text></Pressable></View>)}</View> : <View style={styles.panel}><EmptyState title="Tudo em dia" subtitle="Não há lançamentos pendentes de confirmação." /></View>}{!!error && <Text style={styles.chatError}>{error}</Text>}</ScrollView>;
}

function AccountsScreen({ token, bootstrap, areaId }: { token: string; bootstrap: Bootstrap; areaId: number | null }) {
  const [items, setItems] = useState<Account[]>(bootstrap.accounts.filter((a) => a.person_id === areaId)); const [adding, setAdding] = useState(false); const [name, setName] = useState(''); const [bank, setBank] = useState(''); const [balance, setBalance] = useState('0'); const [personId, setPersonId] = useState(areaId ? String(areaId) : ''); const [kind, setKind] = useState('checking');
  useEffect(() => { void api<{ items: Account[] }>(`/accounts${areaId ? `?area_id=${areaId}` : ''}`, token).then((r) => setItems(r.items)); }, [token, areaId]);
  const save = async () => { const parsed = balance.replace(/\./g, '').replace(',', '.'); if (!name.trim() || !personId) return Alert.alert('Confira os dados', 'Informe o nome e a área financeira.'); try { const result = await api<Account>('/accounts', token, { method: 'POST', body: JSON.stringify({ name: name.trim(), bank_name: bank.trim(), account_type: kind, initial_balance: parsed, person_id: Number(personId), color: '#6c5ce7' }) }); setItems((current) => [...current, result]); setAdding(false); } catch (e) { Alert.alert('Não foi possível criar a conta', friendlyError(e)); } };
  const types: Option[] = [{ value: 'checking', label: 'Conta corrente' }, { value: 'savings', label: 'Poupança' }, { value: 'investment', label: 'Investimento' }, { value: 'digital_wallet', label: 'Carteira digital' }, { value: 'cash', label: 'Dinheiro' }];
  return <ScrollView contentContainerStyle={styles.content}><View style={styles.moduleIntro}><Text style={styles.eyebrow}>CONTAS BANCÁRIAS</Text><Text style={styles.panelSubtitle}>Veja suas contas e associe novas receitas e pagamentos à conta certa.</Text></View><Pressable style={styles.moreLaunch} onPress={() => setAdding(true)}><View style={styles.moreLaunchIcon}><Feather name="plus" size={19} color="white" /></View><View style={{ flex: 1 }}><Text style={styles.moreLaunchTitle}>Adicionar conta</Text><Text style={styles.moreLaunchSub}>Conta corrente, poupança ou carteira</Text></View><Feather name="chevron-right" size={17} color={C.muted} /></Pressable>{items.map((item) => <View key={item.id} style={styles.panel}><View style={styles.accountHeading}><View style={styles.accountIcon}><Feather name="briefcase" size={18} color={C.purpleLight} /></View><View style={styles.featureCopy}><Text style={styles.featureTitle}>{item.name}</Text><Text style={styles.featureDetail}>{item.bank_name || item.account_type.replace('_', ' ')} · {bootstrap.areas.find((a) => a.id === item.person_id)?.name}</Text></View><Text style={styles.ledgerTotal}>{money(item.initial_balance)}</Text></View></View>)}<Modal visible={adding} transparent animationType="slide" onRequestClose={() => setAdding(false)}><Pressable style={styles.modalScrim} onPress={() => setAdding(false)}><Pressable style={styles.featureSheet} onPress={() => undefined}><View style={styles.sheetHandle} /><Text style={styles.modalTitle}>Nova conta</Text><Field label="Nome da conta" value={name} onChangeText={setName} placeholder="Ex.: Conta principal" /><Field label="Banco" value={bank} onChangeText={setBank} placeholder="Opcional" /><SelectField label="Tipo" value={kind} options={types} placeholder="Escolha o tipo" onChange={setKind} /><Field label="Saldo inicial (R$)" value={balance} onChangeText={setBalance} keyboardType="decimal-pad" /><SelectField label="Área financeira" value={personId} options={bootstrap.areas.filter((x) => x.can_write).map((x) => ({ value: String(x.id), label: x.name }))} placeholder="Escolha uma área" onChange={setPersonId} /><View style={styles.formButtons}><SecondaryButton label="Cancelar" onPress={() => setAdding(false)} /><PrimaryButton label="Salvar conta" onPress={() => void save()} /></View></Pressable></Pressable></Modal></ScrollView>;
}

function FinancingScreen({ token, bootstrap, areaId }: { token: string; bootstrap: Bootstrap; areaId: number | null }) {
  const [items, setItems] = useState<any[]>([]); const [adding, setAdding] = useState(false); const [description, setDescription] = useState(''); const [amount, setAmount] = useState(''); const [installments, setInstallments] = useState(''); const [personId, setPersonId] = useState(areaId ? String(areaId) : ''); const [loading, setLoading] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { const r = await api<{ items: any[] }>(`/financings${areaId ? `?area_id=${areaId}` : ''}`, token); setItems(r.items); } catch (e) { Alert.alert('Falha ao carregar contratos', friendlyError(e)); } finally { setLoading(false); } }, [token, areaId]);
  useEffect(() => { void load(); }, [load]);
  const save = async () => { const parsed = amount.replace(/\./g, '').replace(',', '.'); if (!description.trim() || Number(parsed) <= 0 || Number(installments) <= 0 || !personId) return Alert.alert('Confira os dados', 'Informe descrição, parcela, total de parcelas e área.'); try { await api('/financings', token, { method: 'POST', body: JSON.stringify({ description: description.trim(), person_id: Number(personId), total_installments: Number(installments), paid_installments: 0, installment_amount: parsed }) }); setAdding(false); await load(); } catch (e) { Alert.alert('Não foi possível cadastrar', friendlyError(e)); } };
  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={C.purpleLight} />}><View style={styles.moduleIntro}><Text style={styles.eyebrow}>CONTRATOS E PARCELAS</Text><Text style={styles.panelSubtitle}>Acompanhe o que falta pagar e mantenha as parcelas futuras programadas.</Text></View><Pressable style={styles.moreLaunch} onPress={() => setAdding(true)}><View style={styles.moreLaunchIcon}><Feather name="plus" size={19} color="white" /></View><View style={{ flex: 1 }}><Text style={styles.moreLaunchTitle}>Novo financiamento ou dívida</Text><Text style={styles.moreLaunchSub}>Cria as parcelas mensais pendentes</Text></View><Feather name="chevron-right" size={17} color={C.muted} /></Pressable>{items.map((item) => <View key={item.id} style={styles.panel}><View style={styles.statementHeader}><View><Text style={styles.panelTitle}>{item.description}</Text><Text style={styles.featureDetail}>{item.institution || item.person_name} · {item.paid_installments}/{item.total_installments} parcelas</Text></View><Text style={styles.ledgerTotal}>{money(item.installment_amount)}</Text></View><View style={styles.budgetProgressTrack}><View style={[styles.budgetProgressFill, { width: `${Math.min(100, item.paid_installments / item.total_installments * 100)}%` }]} /></View><View style={styles.budgetStats}><Text style={styles.budgetStat}>Restam <Text style={styles.budgetStatValue}>{item.remaining_installments}</Text></Text><Text style={styles.budgetStat}>Saldo devedor <Text style={styles.budgetStatValue}>{money(item.outstanding_balance)}</Text></Text><Text style={styles.budgetStat}>{item.status === 'active' ? 'Ativo' : 'Quitado'}</Text></View></View>)}<Modal visible={adding} transparent animationType="slide" onRequestClose={() => setAdding(false)}><Pressable style={styles.modalScrim} onPress={() => setAdding(false)}><Pressable style={styles.featureSheet} onPress={() => undefined}><View style={styles.sheetHandle} /><Text style={styles.modalTitle}>Novo contrato</Text><Field label="Descrição" value={description} onChangeText={setDescription} /><Field label="Valor da parcela" value={amount} onChangeText={setAmount} keyboardType="decimal-pad" /><Field label="Quantidade de parcelas" value={installments} onChangeText={setInstallments} keyboardType="number-pad" /><SelectField label="Área financeira" value={personId} options={bootstrap.areas.filter((x) => x.can_write).map((x) => ({ value: String(x.id), label: x.name }))} placeholder="Escolha uma área" onChange={setPersonId} /><View style={styles.formButtons}><SecondaryButton label="Cancelar" onPress={() => setAdding(false)} /><PrimaryButton label="Cadastrar" onPress={() => void save()} /></View></Pressable></Pressable></Modal></ScrollView>;
}

function AreasScreen({ token, bootstrap }: { token: string; bootstrap: Bootstrap }) {
  const [items, setItems] = useState(bootstrap.areas); const [name, setName] = useState(''); const [type, setType] = useState('personal'); const [adding, setAdding] = useState(false);
  const create = async () => { if (!name.trim()) return; try { const result = await api<Area>('/areas', token, { method: 'POST', body: JSON.stringify({ name: name.trim(), person_type: type }) }); setItems((current) => [...current, result]); setAdding(false); } catch (e) { Alert.alert('Não foi possível criar a área', friendlyError(e)); } };
  const setDefault = async (id: number) => { try { await api(`/areas/${id}/default`, token, { method: 'POST' }); Alert.alert('Área padrão atualizada', 'Ela será usada como seleção inicial.'); } catch (e) { Alert.alert('Falha', friendlyError(e)); } };
  return <ScrollView contentContainerStyle={styles.content}><View style={styles.moduleIntro}><Text style={styles.eyebrow}>ÁREAS FINANCEIRAS</Text><Text style={styles.panelSubtitle}>Separe suas finanças pessoais e compartilhadas e escolha qual área abrir primeiro.</Text></View>{items.map((item) => <Pressable key={item.id} style={styles.panel} onPress={() => void setDefault(item.id)}><View style={styles.accountHeading}><View style={styles.accountIcon}><Feather name="users" size={18} color={C.purpleLight} /></View><View style={styles.featureCopy}><Text style={styles.featureTitle}>{item.name}</Text><Text style={styles.featureDetail}>{item.person_type === 'shared' ? 'Compartilhada' : 'Pessoal'} · {item.can_write ? 'Pode editar' : 'Somente leitura'}</Text></View><Feather name="check-circle" size={18} color={C.green} /></View></Pressable>)}{bootstrap.user.is_admin && <PrimaryButton label="Adicionar área" onPress={() => setAdding(true)} />}<Modal visible={adding} transparent animationType="slide" onRequestClose={() => setAdding(false)}><Pressable style={styles.modalScrim} onPress={() => setAdding(false)}><Pressable style={styles.featureSheet} onPress={() => undefined}><View style={styles.sheetHandle} /><Text style={styles.modalTitle}>Nova área</Text><Field label="Nome" value={name} onChangeText={setName} /><SelectField label="Tipo" value={type} options={[{ value: 'personal', label: 'Pessoal' }, { value: 'shared', label: 'Compartilhada' }]} placeholder="Tipo da área" onChange={setType} /><View style={styles.formButtons}><SecondaryButton label="Cancelar" onPress={() => setAdding(false)} /><PrimaryButton label="Criar área" onPress={() => void create()} /></View></Pressable></Pressable></Modal></ScrollView>;
}

function CategoriesScreen({ token, bootstrap }: { token: string; bootstrap: Bootstrap }) {
  const [items, setItems] = useState(bootstrap.categories); const [adding, setAdding] = useState(false); const [name, setName] = useState(''); const [group, setGroup] = useState(''); const [kind, setKind] = useState<TransactionType>('expense');
  const create = async () => { if (!name.trim()) return; try { const result = await api<Category>('/categories', token, { method: 'POST', body: JSON.stringify({ name: name.trim(), kind, parent_name: group.trim() || null, color: '#6c5ce7' }) }); setItems((current) => [...current, result]); setAdding(false); } catch (e) { Alert.alert('Não foi possível criar categoria', friendlyError(e)); } };
  return <ScrollView contentContainerStyle={styles.content}><View style={styles.moduleIntro}><Text style={styles.eyebrow}>CATEGORIAS</Text><Text style={styles.panelSubtitle}>Use categorias para deixar as análises e os orçamentos mais úteis.</Text></View>{items.map((item) => <View key={item.id} style={styles.featureRow}><View style={[styles.featureIcon, { backgroundColor: `${item.color}22` }]}><Feather name={item.kind === 'income' ? 'trending-up' : 'tag'} size={17} color={item.color} /></View><View style={styles.featureCopy}><Text style={styles.featureTitle}>{item.name}</Text><Text style={styles.featureDetail}>{item.parent_name ?? (item.kind === 'income' ? 'Receita' : 'Despesa')}</Text></View></View>)}{bootstrap.user.is_admin && <PrimaryButton label="Nova categoria" onPress={() => setAdding(true)} />}<Modal visible={adding} transparent animationType="slide" onRequestClose={() => setAdding(false)}><Pressable style={styles.modalScrim} onPress={() => setAdding(false)}><Pressable style={styles.featureSheet} onPress={() => undefined}><View style={styles.sheetHandle} /><Text style={styles.modalTitle}>Nova categoria</Text><Field label="Nome" value={name} onChangeText={setName} /><Field label="Grupo" value={group} onChangeText={setGroup} placeholder="Ex.: Moradia" /><SelectField label="Tipo" value={kind} options={[{ value: 'expense', label: 'Despesa' }, { value: 'income', label: 'Receita' }]} placeholder="Tipo" onChange={(v) => setKind(v as TransactionType)} /><View style={styles.formButtons}><SecondaryButton label="Cancelar" onPress={() => setAdding(false)} /><PrimaryButton label="Criar" onPress={() => void create()} /></View></Pressable></Pressable></Modal></ScrollView>;
}

function VehiclesScreen({ token }: { token: string }) {
  const [vehicles, setVehicles] = useState<any[]>([]); const [fillups, setFillups] = useState<any[]>([]); const [adding, setAdding] = useState(false); const [name, setName] = useState(''); const [year, setYear] = useState(''); const [odometer, setOdometer] = useState('0'); const [fuel, setFuel] = useState(''); const [loading, setLoading] = useState(false);
  const load = useCallback(async () => { setLoading(true); try { const r = await api<{ vehicles: any[]; fillups: any[] }>('/vehicles', token); setVehicles(r.vehicles); setFillups(r.fillups); } catch (e) { Alert.alert('Falha ao carregar veículos', friendlyError(e)); } finally { setLoading(false); } }, [token]);
  useEffect(() => { void load(); }, [load]);
  const save = async () => { if (!name.trim()) return; try { await api('/vehicles', token, { method: 'POST', body: JSON.stringify({ name: name.trim(), year: year ? Number(year) : null, initial_odometer_km: odometer || '0', fuel_type: fuel || null }) }); setAdding(false); await load(); } catch (e) { Alert.alert('Não foi possível cadastrar', friendlyError(e)); } };
  return <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={C.purpleLight} />}><View style={styles.moduleIntro}><Text style={styles.eyebrow}>VEÍCULOS E ABASTECIMENTO</Text><Text style={styles.panelSubtitle}>Acompanhe quilometragem, gasto com combustível e consumo por veículo.</Text></View>{vehicles.map((v) => <View key={v.id} style={styles.panel}><Text style={styles.panelTitle}>{v.name}</Text><Text style={styles.featureDetail}>{v.year ?? 'Ano não informado'} · {v.fuel_type ?? 'Combustível não informado'} · {Number(v.initial_odometer_km).toLocaleString('pt-BR')} km</Text></View>)}{vehicles.length === 0 && <View style={styles.panel}><EmptyState title="Nenhum veículo cadastrado" subtitle="Adicione um veículo para começar o histórico de abastecimento." /></View>}<PrimaryButton label="Cadastrar veículo" onPress={() => setAdding(true)} /><Text style={styles.panelTitle}>Últimos abastecimentos</Text>{fillups.map((f) => <View key={f.id} style={styles.featureRow}><View style={[styles.featureIcon, { backgroundColor: '#3a2026' }]}><Feather name="droplet" size={17} color={C.red} /></View><View style={styles.featureCopy}><Text style={styles.featureTitle}>{f.vehicle_name} · {money(f.total)}</Text><Text style={styles.featureDetail}>{f.date} · {f.liters} L · {f.odometer_km} km{f.station ? ` · ${f.station}` : ''}</Text></View></View>)}<Modal visible={adding} transparent animationType="slide" onRequestClose={() => setAdding(false)}><Pressable style={styles.modalScrim} onPress={() => setAdding(false)}><Pressable style={styles.featureSheet} onPress={() => undefined}><View style={styles.sheetHandle} /><Text style={styles.modalTitle}>Novo veículo</Text><Field label="Nome" value={name} onChangeText={setName} /><Field label="Ano" value={year} onChangeText={setYear} keyboardType="number-pad" /><Field label="Quilometragem inicial" value={odometer} onChangeText={setOdometer} keyboardType="decimal-pad" /><Field label="Combustível" value={fuel} onChangeText={setFuel} placeholder="Flex, gasolina..." /><View style={styles.formButtons}><SecondaryButton label="Cancelar" onPress={() => setAdding(false)} /><PrimaryButton label="Salvar" onPress={() => void save()} /></View></Pressable></Pressable></Modal></ScrollView>;
}

function ProfileScreen({ user, areas, token, loading, onLogout }: { user?: User; areas: Area[]; token: string; loading: boolean; onLogout: () => void }) {
  const [memories, setMemories] = useState<{ id: number; summary: string }[]>([]); const [passwordOpen, setPasswordOpen] = useState(false); const [currentPassword, setCurrentPassword] = useState(''); const [newPassword, setNewPassword] = useState(''); const [saving, setSaving] = useState(false);
  const loadMemories = useCallback(async () => { try { const result = await api<{ items: { id: number; summary: string }[] }>('/profile/memories', token); setMemories(result.items); } catch { /* memories are optional */ } }, [token]);
  useEffect(() => { void loadMemories(); }, [loadMemories]);
  const removeMemory = (item: { id: number; summary: string }) => Alert.alert('Esquecer esta informação?', item.summary, [{ text: 'Cancelar', style: 'cancel' }, { text: 'Esquecer', style: 'destructive', onPress: () => { void api(`/profile/memories/${item.id}`, token, { method: 'DELETE' }).then(loadMemories).catch((e) => Alert.alert('Falha', friendlyError(e))); } }]);
  const changePassword = async () => { if (newPassword.length < 8) return Alert.alert('Senha muito curta', 'Use pelo menos 8 caracteres.'); setSaving(true); try { await api('/profile/password', token, { method: 'POST', body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }) }); setPasswordOpen(false); Alert.alert('Senha atualizada', 'Entre novamente com sua nova senha.'); onLogout(); } catch (e) { Alert.alert('Não foi possível alterar', friendlyError(e)); } finally { setSaving(false); } };
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <View style={styles.profileHero}><View style={[styles.avatar, styles.profileAvatar]}><Text style={styles.avatarText}>{user?.full_name.slice(0, 1).toUpperCase() ?? 'V'}</Text></View><Text style={styles.profileName}>{user?.full_name ?? 'VitoriaFinance'}</Text><Text style={styles.profileUsername}>@{user?.username}</Text></View>
      <View style={styles.panel}><Text style={styles.panelTitle}>Sua conta</Text><ProfileRow label="Workspace" value={String(user?.workspace_id ?? '—')} /><ProfileRow label="Áreas disponíveis" value={String(areas.length)} /><ProfileRow label="Áreas com escrita" value={String(areas.filter((area) => area.can_write).length)} /></View>
      <View style={styles.panel}><View style={styles.statementHeader}><View><Text style={styles.panelTitle}>O que a Vitoria lembra</Text><Text style={styles.panelSubtitle}>Preferências salvas para personalizar a conversa.</Text></View></View>{memories.length ? memories.map((item) => <View key={item.id} style={styles.memoryRow}><Text style={styles.memoryText}>{item.summary}</Text><Pressable accessibilityLabel="Esquecer memória" onPress={() => removeMemory(item)}><Feather name="trash-2" size={15} color={C.red} /></Pressable></View>) : <Text style={styles.featureDetail}>Nenhuma preferência salva.</Text>}</View>
      <SecondaryButton label="Alterar senha" onPress={() => setPasswordOpen(true)} />
      <View style={styles.profileNote}><Feather name="shield" size={18} color={C.purpleLight} /><Text style={styles.profileNoteText}>Sua sessão é armazenada com proteção do dispositivo. Ao sair, o acesso deste aparelho é revogado.</Text></View>
      <SecondaryButton label={loading ? 'Saindo...' : 'Sair da conta'} onPress={onLogout} danger disabled={loading} />
      <Modal visible={passwordOpen} transparent animationType="slide" onRequestClose={() => setPasswordOpen(false)}><Pressable style={styles.modalScrim} onPress={() => setPasswordOpen(false)}><Pressable style={styles.featureSheet} onPress={() => undefined}><View style={styles.sheetHandle} /><Text style={styles.modalTitle}>Alterar senha</Text><Field label="Senha atual" value={currentPassword} onChangeText={setCurrentPassword} secureTextEntry autoCapitalize="none" /><Field label="Nova senha (mínimo 8 caracteres)" value={newPassword} onChangeText={setNewPassword} secureTextEntry autoCapitalize="none" /><View style={styles.formButtons}><SecondaryButton label="Cancelar" onPress={() => setPasswordOpen(false)} /><PrimaryButton label="Salvar senha" loading={saving} onPress={() => void changePassword()} /></View></Pressable></Pressable></Modal>
    </ScrollView>
  );
}

function TransactionRow({ item, showDate = false }: { item: Transaction; showDate?: boolean }) {
  const income = item.transaction_type === 'income';
  const transfer = item.transaction_type === 'transfer';
  const icon = income ? 'arrow-down-left' : transfer ? 'repeat' : 'arrow-up-right';
  const tone = income ? C.green : transfer ? C.blue : C.red;
  const amountSign = income ? '+' : transfer ? '' : '−';
  const dateText = new Date(`${item.transaction_date}T12:00:00`).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  const subtitle = [showDate ? dateText : null, item.category_name, item.payment_method,
    item.status === 'pending' ? 'Pendente' : null].filter(Boolean).join(' · ') || 'Sem categoria';
  return (
    <View style={styles.transactionRow}>
      <View style={[styles.transactionIcon, { backgroundColor: `${tone}1a` }]}><Feather name={icon as keyof typeof Feather.glyphMap} size={17} color={tone} /></View>
      <View style={styles.transactionCopy}><Text style={styles.transactionName} numberOfLines={1}>{item.description}</Text><Text style={styles.transactionMeta} numberOfLines={1}>{subtitle}</Text></View>
      <View style={styles.transactionAmount}><Text style={[styles.transactionAmountText, { color: tone }]}>{amountSign}{money(item.amount)}</Text>{item.status === 'pending' && <Text style={styles.pendingCaption}>pendente</Text>}</View>
    </View>
  );
}

function StatCard({ label, value, icon, tone }: { label: string; value: string; icon: string; tone: 'green' | 'red' }) {
  const color = tone === 'green' ? C.green : C.red;
  return <View style={styles.statCard}><View style={styles.statCardTop}><Text style={styles.statLabel}>{label}</Text><View style={[styles.statIcon, { backgroundColor: `${color}19` }]}><Feather name={icon as keyof typeof Feather.glyphMap} size={16} color={color} /></View></View><Text style={[styles.statValue, { color }]} numberOfLines={1} adjustsFontSizeToFit>{value}</Text></View>;
}

function QuickAction({ title, subtitle, icon, onPress }: { title: string; subtitle: string; icon: string; onPress: () => void }) {
  return <Pressable style={styles.quickAction} onPress={onPress}><View style={styles.quickIcon}><Feather name={icon as keyof typeof Feather.glyphMap} size={17} color={C.purpleLight} /></View><View style={{ flex: 1 }}><Text style={styles.quickTitle}>{title}</Text><Text style={styles.quickSubtitle}>{subtitle}</Text></View><Feather name="chevron-right" size={17} color={C.faint} /></Pressable>;
}

function AreaButton({ areas, areaId, onChange }: { areas: Area[]; areaId: number | null; onChange: (id: number) => void }) {
  const [open, setOpen] = useState(false);
  const selected = areas.find((area) => area.id === areaId);
  return <>
    <Pressable onPress={() => setOpen(true)} style={styles.areaButton}><Feather name="users" size={14} color={C.purpleLight} /><Text style={styles.areaButtonText} numberOfLines={1}>{selected?.name ?? 'Áreas'}</Text><Feather name="chevron-down" size={14} color={C.muted} /></Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <Pressable style={styles.modalScrim} onPress={() => setOpen(false)}><Pressable style={styles.modalCard} onPress={() => undefined}>
        <Text style={styles.modalTitle}>Área financeira</Text><Text style={styles.modalSub}>Escolha a visão que deseja acompanhar.</Text>
        {areas.map((area) => <Pressable key={area.id} style={styles.modalOption} onPress={() => { onChange(area.id); setOpen(false); }}><View style={{ flex: 1 }}><Text style={styles.modalOptionText}>{area.name}</Text><Text style={styles.modalOptionMeta}>{area.can_write ? 'Leitura e escrita' : 'Somente leitura'}</Text></View>{area.id === areaId && <Feather name="check" size={18} color={C.purpleLight} />}</Pressable>)}
      </Pressable></Pressable>
    </Modal>
  </>;
}

function SelectField({ label, value, options, placeholder, onChange }: { label: string; value: string; options: Option[]; placeholder: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  return <>
    <Text style={styles.fieldLabel}>{label}</Text>
    <Pressable style={styles.selectField} onPress={() => setOpen(true)}><Text style={[styles.selectText, !selected && styles.placeholderText]} numberOfLines={1}>{selected?.label ?? placeholder}</Text><Feather name="chevron-down" size={17} color={C.muted} /></Pressable>
    <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
      <Pressable style={styles.modalScrim} onPress={() => setOpen(false)}><Pressable style={styles.modalSheet} onPress={() => undefined}>
        <View style={styles.sheetHandle} /><Text style={styles.modalTitle}>{label}</Text>
        <ScrollView style={{ maxHeight: 380 }} showsVerticalScrollIndicator={false}>
          {options.length ? options.map((option) => <Pressable key={option.value} style={styles.modalOption} onPress={() => { onChange(option.value); setOpen(false); }}><Text style={styles.modalOptionText}>{option.label}</Text>{option.value === value && <Feather name="check" size={17} color={C.purpleLight} />}</Pressable>) : <Text style={styles.emptyOptions}>Nenhuma opção disponível para esta seleção.</Text>}
        </ScrollView>
        <Pressable style={styles.modalClose} onPress={() => { onChange(''); setOpen(false); }}><Text style={styles.modalCloseText}>Limpar seleção</Text></Pressable>
      </Pressable></Pressable>
    </Modal>
  </>;
}

function Field({ label, right, multiline, ...props }: React.ComponentProps<typeof TextInput> & { label: string; right?: React.ReactNode }) {
  return <View style={styles.fieldWrap}><Text style={styles.fieldLabel}>{label}</Text><View style={[styles.inputFrame, multiline && styles.textAreaFrame]}><TextInput {...props} multiline={multiline} placeholderTextColor={C.faint} style={[styles.input, multiline && styles.textArea]} />{right && <View style={styles.inputRight}>{right}</View>}</View></View>;
}

function Pill({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return <Pressable onPress={onPress} style={[styles.pill, active && styles.pillActive]}><Text style={[styles.pillText, active && styles.pillTextActive]}>{label}</Text></Pressable>;
}

function PrimaryButton({ label, onPress, loading = false }: { label: string; onPress: () => void; loading?: boolean }) {
  return <Pressable disabled={loading} onPress={onPress} style={[styles.primaryButton, loading && styles.disabled]}>{loading ? <ActivityIndicator color="white" /> : <Text style={styles.primaryButtonText}>{label}</Text>}</Pressable>;
}

function SecondaryButton({ label, onPress, danger = false, disabled = false }: { label: string; onPress: () => void; danger?: boolean; disabled?: boolean }) {
  return <Pressable disabled={disabled} onPress={onPress} style={[styles.secondaryButton, danger && styles.dangerButton, disabled && styles.disabled]}><Text style={[styles.secondaryButtonText, danger && styles.dangerText]}>{label}</Text></Pressable>;
}

function TabButton({ label, icon, active, onPress }: { label: string; icon: keyof typeof Feather.glyphMap; active: boolean; onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.tabButton}><Feather name={icon} size={20} color={active ? C.purpleLight : C.muted} /><Text style={[styles.tabLabel, active && styles.activeText]}>{label}</Text></Pressable>;
}

function EmptyState({ title, subtitle, action, onAction }: { title: string; subtitle: string; action?: string; onAction?: () => void }) {
  return <View style={styles.emptyState}><View style={styles.emptyIcon}><Feather name="inbox" size={19} color={C.purpleLight} /></View><Text style={styles.emptyTitle}>{title}</Text><Text style={styles.emptyText}>{subtitle}</Text>{action && onAction && <Pressable onPress={onAction}><Text style={styles.emptyAction}>{action}</Text></Pressable>}</View>;
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return <View style={styles.profileRow}><Text style={styles.profileRowLabel}>{label}</Text><Text style={styles.profileRowValue}>{value}</Text></View>;
}

export default function App() { return <SafeAreaProvider><FinanceApp /></SafeAreaProvider>; }

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg }, flex: { flex: 1 }, center: { flex: 1, backgroundColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  topbar: { minHeight: 72, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 19, paddingVertical: 9, gap: 9, backgroundColor: C.bg },
  topTitleWrap: { flex: 1 }, kicker: { color: C.purpleLight, fontSize: 9, fontWeight: '800', letterSpacing: 1.6 }, topTitle: { color: C.text, fontWeight: '700', fontSize: 22, marginTop: 2 },
  avatar: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 19, backgroundColor: C.purple }, avatarText: { color: 'white', fontWeight: '800', fontSize: 16 },
  areaButton: { maxWidth: 148, height: 38, paddingHorizontal: 10, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, flexDirection: 'row', alignItems: 'center', gap: 6 }, areaButtonText: { color: C.text, fontSize: 12, fontWeight: '600', flexShrink: 1 },
  body: { flex: 1 }, content: { padding: 18, paddingBottom: 26, gap: 15 },
  banner: { flexDirection: 'row', alignItems: 'center', gap: 9, backgroundColor: '#3b2529', marginHorizontal: 16, marginBottom: 6, padding: 11, borderRadius: 12 }, bannerText: { flex: 1, color: '#ffd0cc', fontSize: 12 },
  greetingRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 2 }, eyebrow: { color: C.purpleLight, letterSpacing: 1.25, fontWeight: '800', fontSize: 9 }, sectionTitle: { color: C.text, fontSize: 20, fontWeight: '700', marginTop: 5 },
  smallLink: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingBottom: 3 }, smallLinkText: { color: C.purpleLight, fontWeight: '600', fontSize: 12 },
  balanceCard: { padding: 20, borderRadius: 20, backgroundColor: C.purple, overflow: 'hidden' }, balanceHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, balanceLabel: { color: '#e6e1ff', fontSize: 13, fontWeight: '600' }, walletIcon: { width: 33, height: 33, alignItems: 'center', justifyContent: 'center', borderRadius: 11, backgroundColor: '#ffffff24' },
  balanceValue: { marginTop: 18, color: 'white', fontSize: 31, fontWeight: '800', letterSpacing: -0.8 }, balanceFoot: { flexDirection: 'row', alignItems: 'center', gap: 7, marginTop: 15 }, balanceFootText: { color: '#e1dcff', fontSize: 11 },
  statGrid: { flexDirection: 'row', gap: 11 }, statCard: { flex: 1, minHeight: 102, padding: 14, borderRadius: 16, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, justifyContent: 'space-between' }, statCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 5 }, statLabel: { color: C.muted, fontSize: 11, fontWeight: '500', flexShrink: 1 }, statIcon: { width: 27, height: 27, borderRadius: 9, alignItems: 'center', justifyContent: 'center' }, statValue: { fontSize: 17, fontWeight: '700', marginTop: 10 },
  quickActions: { flexDirection: 'row', gap: 10 }, quickAction: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9, minHeight: 68, paddingHorizontal: 11, borderWidth: 1, borderColor: C.line, borderRadius: 15, backgroundColor: C.surface }, quickIcon: { width: 31, height: 31, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#302b4d' }, quickTitle: { color: C.text, fontSize: 11, fontWeight: '700' }, quickSubtitle: { color: C.muted, fontSize: 9, marginTop: 3 },
  panel: { paddingHorizontal: 15, paddingVertical: 15, borderRadius: 17, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line }, panelHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }, panelTitle: { color: C.text, fontSize: 16, fontWeight: '700' }, panelSubtitle: { color: C.muted, fontSize: 11, marginTop: 3 },
  transactionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line }, transactionIcon: { width: 37, height: 37, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }, transactionCopy: { flex: 1, minWidth: 0 }, transactionName: { color: C.text, fontSize: 12, fontWeight: '600' }, transactionMeta: { color: C.muted, fontSize: 10, marginTop: 4 }, transactionAmount: { alignItems: 'flex-end', maxWidth: 120 }, transactionAmountText: { color: C.text, fontSize: 12, fontWeight: '700' }, pendingCaption: { color: '#e7bd6f', fontSize: 9, marginTop: 3 }, refreshHint: { color: C.faint, fontSize: 10, textAlign: 'center', marginTop: 2, marginBottom: 2 },
  monthNav: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5 }, navCircle: { width: 40, height: 40, borderRadius: 14, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' }, monthTitleWrap: { alignItems: 'center' }, monthTitle: { color: C.text, fontSize: 18, fontWeight: '700', marginTop: 4 }, periodBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: 6, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8, backgroundColor: '#18352f' }, periodBadgeClosed: { backgroundColor: '#302b4d' }, periodDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.green }, periodDotClosed: { backgroundColor: C.purpleLight }, periodBadgeText: { color: C.green, fontSize: 9, fontWeight: '700' }, periodBadgeTextClosed: { color: C.purpleLight },
  monthSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', padding: 18, borderRadius: 16, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line }, summaryLabel: { color: C.muted, fontSize: 11 }, summaryValue: { fontSize: 17, fontWeight: '700', marginTop: 6 }, summaryDivider: { width: 1, height: 35, backgroundColor: C.line }, monthListHeading: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }, roundAdd: { width: 36, height: 36, borderRadius: 13, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center' },
  projectedCard: { padding: 17, borderRadius: 17, backgroundColor: '#211d36', borderWidth: 1, borderColor: '#4c427e' }, projectedCardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, projectedLabel: { color: C.purpleLight, fontSize: 9, fontWeight: '800', letterSpacing: 1.1 }, projectedValue: { color: C.text, fontSize: 27, fontWeight: '800', marginTop: 6 }, projectedIcon: { width: 38, height: 38, borderRadius: 13, backgroundColor: '#302b4d', alignItems: 'center', justifyContent: 'center' }, projectedFoot: { flexDirection: 'row', alignItems: 'center', gap: 11, borderTopWidth: 1, borderTopColor: '#40385f', marginTop: 13, paddingTop: 11 }, projectedFootText: { color: '#c7c1e8', fontSize: 10, flex: 1 },
  balancePair: { flexDirection: 'row', gap: 10 }, balanceTile: { flex: 1, minWidth: 0, minHeight: 107, justifyContent: 'space-between', padding: 13, borderWidth: 1, borderRadius: 16 }, balanceTileActual: { backgroundColor: C.surface, borderColor: C.line }, balanceTileProjected: { backgroundColor: '#211d36', borderColor: '#4c427e' }, balanceTileHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 }, balanceTileLabel: { color: C.purpleLight, fontSize: 8, fontWeight: '800', letterSpacing: 0.7 }, balanceTileValue: { color: C.text, fontSize: 20, fontWeight: '800', marginTop: 6 }, balanceTileHint: { color: C.muted, fontSize: 9, marginTop: 5 },
  ledgerSection: { gap: 8 }, ledgerHeader: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, ledgerTitleGroup: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }, ledgerIcon: { width: 35, height: 35, borderRadius: 11, backgroundColor: C.raised, alignItems: 'center', justifyContent: 'center' }, ledgerTotal: { fontSize: 15, fontWeight: '800' }, ledgerFooter: { flexDirection: 'row', justifyContent: 'flex-end', gap: 18, paddingHorizontal: 4 }, ledgerFooterText: { color: C.muted, fontSize: 10 }, ledgerFooterValue: { color: C.text, fontWeight: '700' }, ledgerCardRow: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line },
  monthFilters: { flexDirection: 'row', gap: 8, paddingRight: 4 }, monthFilter: { minHeight: 38, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, monthFilterActive: { borderColor: '#51469b', backgroundColor: '#292540' }, monthFilterText: { color: C.muted, fontSize: 11, fontWeight: '600' }, monthFilterTextActive: { color: C.purpleLight }, monthFilterCount: { minWidth: 17, textAlign: 'center', color: C.faint, fontSize: 9, fontWeight: '700' }, monthFilterCountActive: { color: C.purpleLight }, dayGroup: { gap: 7 }, dayGroupHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 2, paddingTop: 3 }, dayGroupCopy: { flex: 1 }, dayGroupDate: { color: C.text, fontSize: 12, fontWeight: '700' }, dayGroupCount: { color: C.muted, fontSize: 10, marginTop: 3 }, dayGroupTotals: { alignItems: 'flex-end', gap: 2 }, dayGroupTotal: { fontSize: 10, fontWeight: '700' }, dayGroupPanel: { paddingVertical: 4 },
  monthSection: { gap: 10 }, budgetSectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, cardMonthRow: { minHeight: 67, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, borderWidth: 1, borderColor: C.line, borderRadius: 15, backgroundColor: C.surface }, cardMonthIcon: { width: 39, height: 39, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#302b4d' }, cardMonthCopy: { flex: 1, minWidth: 0 }, cardMonthAmount: { flexDirection: 'row', alignItems: 'center', gap: 4 }, backToMonth: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 3 }, backToMonthText: { color: C.purpleLight, fontSize: 12, fontWeight: '700' }, cardDetailSummary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', padding: 18, borderRadius: 16, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line }, cardDetailTotal: { color: C.text, fontSize: 20, fontWeight: '800', marginTop: 5 }, cardDetailPending: { fontSize: 15, fontWeight: '700', marginTop: 7 },
  budgetCard: { padding: 14, borderWidth: 1, borderColor: C.line, borderRadius: 15, backgroundColor: C.surface }, budgetCardExceeded: { borderColor: '#694047' }, budgetCardReleased: { opacity: 0.82 }, budgetCardHeading: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 }, budgetCardTitle: { flex: 1, minWidth: 0 }, budgetRemaining: { color: C.green, fontSize: 11, fontWeight: '700', flexShrink: 0 }, budgetProgressTrack: { height: 7, marginTop: 12, marginBottom: 10, overflow: 'hidden', borderRadius: 5, backgroundColor: '#292f3c' }, budgetProgressFill: { height: 7, borderRadius: 5, backgroundColor: C.purple }, budgetProgressExceeded: { backgroundColor: C.red }, budgetStats: { flexDirection: 'row', justifyContent: 'space-between', flexWrap: 'wrap', gap: 7 }, budgetStat: { color: C.muted, fontSize: 9 }, budgetStatValue: { color: C.text, fontSize: 10, fontWeight: '700' }, budgetCardFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 11, paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line }, budgetProjectionHint: { color: C.purpleLight, fontSize: 9, fontWeight: '600' }, budgetActions: { flexDirection: 'row', gap: 17, paddingHorizontal: 4 }, budgetEditorCard: { width: '100%', maxWidth: 500, maxHeight: '85%', marginTop: 'auto', backgroundColor: C.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: C.line, padding: 20, paddingBottom: 28 }, budgetCategoryLocked: { marginBottom: 10 }, budgetLockedValue: { minHeight: 48, paddingHorizontal: 13, paddingVertical: 15, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.raised, color: C.text, fontSize: 13 },
  emptyState: { alignItems: 'center', paddingVertical: 30, paddingHorizontal: 18 }, emptyIcon: { width: 42, height: 42, borderRadius: 15, backgroundColor: '#302b4d', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }, emptyTitle: { color: C.text, fontSize: 13, fontWeight: '700' }, emptyText: { color: C.muted, fontSize: 11, textAlign: 'center', lineHeight: 17, marginTop: 6 }, emptyAction: { color: C.purpleLight, fontSize: 12, fontWeight: '700', marginTop: 13 },
  tabBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', paddingTop: 8, backgroundColor: C.surface, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line }, tabButton: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center', gap: 3 }, tabLabel: { color: C.muted, fontSize: 9, fontWeight: '600' }, activeText: { color: C.purpleLight }, addTab: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: -19, gap: 1 }, addCircle: { width: 49, height: 49, borderRadius: 25, backgroundColor: C.purple, borderWidth: 4, borderColor: C.bg, alignItems: 'center', justifyContent: 'center' },
  loginRoot: { flex: 1, backgroundColor: C.bg }, loginScroll: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 29, paddingVertical: 34 }, logoMark: { width: 53, height: 53, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: C.purple }, logoMarkText: { color: 'white', fontSize: 28, fontWeight: '900' }, loginBrand: { color: C.text, fontSize: 24, fontWeight: '800', marginTop: 14 }, loginBrandAccent: { color: C.purpleLight }, loginHeading: { color: C.text, fontWeight: '800', fontSize: 30, lineHeight: 37, marginTop: 38, letterSpacing: -0.8 }, loginSubheading: { color: C.muted, fontSize: 14, marginTop: 10 }, loginForm: { gap: 6, marginTop: 28 }, loginError: { color: '#ffaaa2', fontSize: 12, paddingVertical: 8 }, loginFoot: { color: C.faint, textAlign: 'center', fontSize: 11, marginTop: 27 },
  fieldWrap: { marginBottom: 10 }, fieldLabel: { color: C.muted, fontSize: 11, fontWeight: '600', marginBottom: 7 }, inputFrame: { minHeight: 48, paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, flexDirection: 'row', alignItems: 'center' }, input: { flex: 1, color: C.text, fontSize: 14, paddingVertical: 12 }, textAreaFrame: { minHeight: 88, alignItems: 'flex-start' }, textArea: { minHeight: 80, textAlignVertical: 'top' }, inputRight: { paddingLeft: 9 },
  primaryButton: { minHeight: 48, paddingHorizontal: 16, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: C.purple }, primaryButtonText: { color: 'white', fontSize: 13, fontWeight: '700' }, disabled: { opacity: 0.65 }, secondaryButton: { minHeight: 46, paddingHorizontal: 17, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: C.raised, borderWidth: 1, borderColor: C.line }, secondaryButtonText: { color: C.text, fontSize: 12, fontWeight: '700' }, dangerButton: { borderColor: '#703a3a', backgroundColor: '#392326' }, dangerText: { color: '#ffaaa2' },
  formContent: { paddingTop: 10, gap: 6 }, formTop: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 5 }, backButton: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: C.raised }, typeSwitch: { flexDirection: 'row', padding: 4, borderRadius: 13, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, marginBottom: 8 }, typeOption: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' }, typeOptionActive: { backgroundColor: C.purple }, typeOptionText: { color: C.muted, fontSize: 10, fontWeight: '600' }, typeOptionTextActive: { color: 'white' },
  amountBox: { padding: 15, borderRadius: 15, borderWidth: 1, borderColor: '#4c427e', backgroundColor: '#211d36', marginBottom: 8 }, amountCaption: { color: C.purpleLight, letterSpacing: 1, fontSize: 9, fontWeight: '800' }, amountInputRow: { flexDirection: 'row', alignItems: 'center', marginTop: 5 }, currencyPrefix: { color: C.muted, fontSize: 16, fontWeight: '600', marginRight: 9 }, amountInput: { flex: 1, color: 'white', fontSize: 28, fontWeight: '800', paddingVertical: 3 }, selectField: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 13, borderRadius: 12, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, marginBottom: 12 }, selectText: { color: C.text, fontSize: 13, flex: 1, marginRight: 10 }, placeholderText: { color: C.faint }, paymentSwitch: { marginBottom: 13 }, pillRow: { flexDirection: 'row', gap: 8, marginTop: 1, marginBottom: 10 }, pill: { minHeight: 36, minWidth: 75, paddingHorizontal: 15, borderRadius: 11, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }, pillActive: { borderColor: C.purple, backgroundColor: '#302b4d' }, pillText: { color: C.muted, fontSize: 11, fontWeight: '600' }, pillTextActive: { color: C.purpleLight }, inlineHint: { color: C.muted, fontSize: 11, marginBottom: 13, lineHeight: 17 }, formButtons: { flexDirection: 'row', gap: 9, marginTop: 8, marginBottom: 10 },
  modalScrim: { flex: 1, padding: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#000a' }, modalCard: { width: '100%', maxWidth: 440, backgroundColor: C.surface, borderWidth: 1, borderColor: C.line, borderRadius: 20, padding: 19 }, modalSheet: { width: '100%', maxWidth: 520, maxHeight: '80%', marginTop: 'auto', backgroundColor: C.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: C.line, padding: 20, paddingBottom: 26 }, sheetHandle: { width: 38, height: 4, borderRadius: 3, backgroundColor: '#596071', alignSelf: 'center', marginBottom: 16 }, modalTitle: { color: C.text, fontSize: 17, fontWeight: '700' }, modalSub: { color: C.muted, fontSize: 11, lineHeight: 17, marginTop: 5, marginBottom: 12 }, modalOption: { minHeight: 53, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line }, modalOptionText: { color: C.text, fontSize: 13, fontWeight: '600' }, modalOptionMeta: { color: C.muted, fontSize: 10, marginTop: 3 }, modalClose: { alignItems: 'center', paddingTop: 13 }, modalCloseText: { color: C.purpleLight, fontSize: 12, fontWeight: '700' }, emptyOptions: { color: C.muted, fontSize: 12, paddingVertical: 20 },
  datePickerCard: { width: '100%', maxWidth: 440, marginTop: 'auto', backgroundColor: C.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: C.line, padding: 20, paddingBottom: 28 },
  creditCard: { padding: 18, borderWidth: 1, borderRadius: 18, backgroundColor: '#20232d', marginBottom: 12 }, creditHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }, creditBrand: { color: C.muted, letterSpacing: 1.2, fontSize: 8, fontWeight: '800' }, creditName: { color: C.text, fontSize: 16, fontWeight: '700', marginTop: 4 }, creditIcon: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, creditLimit: { color: 'white', fontSize: 22, fontWeight: '800', marginTop: 23 }, creditLimitCaption: { color: C.muted, fontSize: 10, marginTop: 3 }, creditFooter: { flexDirection: 'row', justifyContent: 'space-between', gap: 8, borderTopWidth: 1, borderTopColor: C.line, paddingTop: 12, marginTop: 17 }, creditFooterText: { color: '#c4cada', fontSize: 9, flexShrink: 1 },
  profileHero: { alignItems: 'center', paddingVertical: 18 }, profileAvatar: { width: 66, height: 66, borderRadius: 23 }, profileName: { color: C.text, fontSize: 19, fontWeight: '700', marginTop: 11 }, profileUsername: { color: C.muted, fontSize: 12, marginTop: 3 }, profileRow: { minHeight: 43, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line, marginTop: 7 }, profileRowLabel: { color: C.muted, fontSize: 11 }, profileRowValue: { color: C.text, fontSize: 11, fontWeight: '600' }, profileNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, padding: 14, borderRadius: 14, backgroundColor: '#211d36', marginVertical: 3 }, profileNoteText: { flex: 1, color: '#cbc5f6', fontSize: 11, lineHeight: 17 },
  topAdd: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: C.purple },
  aiTab: { flex: 1, height: 56, alignItems: 'center', justifyContent: 'center', gap: 2, marginTop: -13 }, aiCircle: { width: 50, height: 50, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: C.purple, borderWidth: 4, borderColor: C.bg }, aiCircleActive: { backgroundColor: '#806fff', transform: [{ scale: 1.08 }] }, aiSpark: { position: 'absolute', top: 8, right: 8 }, launchTab: { flex: 1, height: 48, alignItems: 'center', justifyContent: 'center', gap: 2 }, launchCircle: { width: 35, height: 35, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: C.raised }, launchCircleActive: { backgroundColor: C.purple },
  chatScreen: { flex: 1, paddingHorizontal: 16, paddingBottom: 8 }, chatWelcome: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 30 }, chatLogo: { width: 72, height: 72, borderRadius: 25, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }, chatLogoText: { color: 'white', fontSize: 38, fontWeight: '800' }, chatStar: { position: 'absolute', top: 12, right: 13 }, chatWelcomeText: { color: C.muted, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 8, maxWidth: 310 }, chatSuggestions: { width: '100%', gap: 9, marginTop: 23 }, chatSuggestion: { minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 13, borderWidth: 1, borderColor: C.line, borderRadius: 13, backgroundColor: C.surface }, chatSuggestionText: { color: C.text, fontSize: 11 }, chatMessages: { flex: 1 }, chatMessageContent: { paddingVertical: 14, gap: 10 }, chatBubble: { maxWidth: '88%', paddingHorizontal: 14, paddingVertical: 11, borderRadius: 17 }, chatBubbleUser: { alignSelf: 'flex-end', backgroundColor: C.purple }, chatBubbleAssistant: { alignSelf: 'flex-start', backgroundColor: C.surface, borderWidth: 1, borderColor: C.line }, chatBubbleText: { color: C.text, fontSize: 13, lineHeight: 19 }, chatActionRow: { flexDirection: 'row', alignSelf: 'flex-start', gap: 8, marginTop: -2 }, chatActionButton: { minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingHorizontal: 14, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, chatActionConfirm: { borderColor: '#2e5949', backgroundColor: '#172d27' }, chatActionText: { fontSize: 11, fontWeight: '700' }, chatComposer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, padding: 8, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, chatInput: { flex: 1, maxHeight: 110, minHeight: 41, paddingHorizontal: 9, paddingVertical: 10, color: C.text, fontSize: 13 }, chatSend: { width: 39, height: 39, borderRadius: 13, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center' }, chatError: { color: '#ffaaa1', fontSize: 11, marginVertical: 8 },
  moreWelcome: { padding: 17, borderRadius: 18, backgroundColor: '#211d36', borderWidth: 1, borderColor: '#40385f' }, moreWelcomeTitle: { color: C.text, fontSize: 22, fontWeight: '800', marginTop: 7, marginBottom: 1 }, moreLaunch: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 13, paddingVertical: 11, borderRadius: 15, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, moreLaunchIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.purple }, moreLaunchTitle: { color: C.text, fontSize: 12, fontWeight: '700' }, moreLaunchSub: { color: C.muted, fontSize: 10, marginTop: 4 }, featureRow: { minHeight: 68, flexDirection: 'row', alignItems: 'center', gap: 11, padding: 10, borderWidth: 1, borderColor: C.line, borderRadius: 15, backgroundColor: C.surface }, featureIcon: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center' }, featureCopy: { flex: 1, minWidth: 0 }, featureTitle: { color: C.text, fontSize: 12, fontWeight: '700' }, featureDetail: { color: C.muted, fontSize: 10, marginTop: 4 }, memoryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line }, memoryText: { flex: 1, color: C.text, fontSize: 11, lineHeight: 17 }, moduleIntro: { gap: 4, marginBottom: 1 }, moduleActionRow: { gap: 8 }, purchaseButton: { minHeight: 47, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 13, backgroundColor: C.purple }, purchaseButtonText: { color: 'white', fontSize: 12, fontWeight: '700' },
  recurringCard: { padding: 13, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, gap: 11 }, recurringHeading: { flexDirection: 'row', alignItems: 'center', gap: 9 }, recurringActions: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 9, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line }, occurrenceDone: { flex: 1, color: C.green, fontSize: 10, fontWeight: '700' }, smallPrimary: { minHeight: 34, paddingHorizontal: 11, borderRadius: 10, backgroundColor: C.purple, alignItems: 'center', justifyContent: 'center' }, smallPrimaryText: { color: 'white', fontSize: 10, fontWeight: '700' }, smallGhost: { minHeight: 34, paddingHorizontal: 9, borderRadius: 10, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center' }, smallGhostText: { color: C.muted, fontSize: 10 }, iconAction: { width: 30, height: 34, alignItems: 'center', justifyContent: 'center' }, featureSheet: { width: '100%', maxWidth: 520, maxHeight: '88%', marginTop: 'auto', backgroundColor: C.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, borderColor: C.line, padding: 20, paddingBottom: 28 },
  statementHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }, statementTotals: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 12, marginBottom: 5, borderRadius: 13, backgroundColor: C.raised }, invoiceFooter: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 12 }, cardOpenHint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 12, paddingTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line }, cardOpenText: { color: C.purpleLight, fontSize: 10, fontWeight: '600' }, cardPurchaseItem: { paddingBottom: 5, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line }, cardPurchaseActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 17, paddingBottom: 7 }, cardActionText: { color: C.purpleLight, fontSize: 10, fontWeight: '600' }, futureRow: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: C.line, paddingBottom: 8, marginBottom: 8 }, accountHeading: { flexDirection: 'row', alignItems: 'center', gap: 10 }, accountIcon: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#302b4d' }, chartMonth: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 7, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: C.line }, chartMonthLabel: { width: 34, color: C.muted, fontSize: 10, textTransform: 'capitalize' }, chartTracks: { flex: 1, gap: 3 }, chartTrack: { height: 5, borderRadius: 4 }, chartMonthValue: { width: 76, textAlign: 'right', color: C.text, fontSize: 9, fontWeight: '600' }, twoFields: { flexDirection: 'row', gap: 10 },
});
