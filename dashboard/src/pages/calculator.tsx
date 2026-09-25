import { Helmet } from 'react-helmet-async';
import { CalculatorView } from '@/sections/calculator/calculator-view';

export default function CalculatorPage() {
  return (
    <>
      <Helmet>
        <title>Planner · Pioneer HQ</title>
      </Helmet>
      <CalculatorView />
    </>
  );
}
