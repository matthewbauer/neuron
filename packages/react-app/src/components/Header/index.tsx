import React from 'react'
import styled from 'styled-components'

const AppHeader = styled.div`
  display: flex;
  justify-content: space-between;
  height: 40px;
  border-bottom: solid 1px #ccc;
`

const Header = () => (
  <AppHeader>
    <div>Header goes here</div>
    <div>* Network status</div>
    <div>Misc</div>
  </AppHeader>
)

export default Header
